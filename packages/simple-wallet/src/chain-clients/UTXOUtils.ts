import { logger } from "../utils/logger";
import { createTransactionOutputEntity } from "../db/dbutils";
import {
    BTC_DOGE_DEC_PLACES,
    BTC_DUST_AMOUNT,
    BTC_FEE_SECURITY_MARGIN,
    BTC_LEDGER_CLOSE_TIME_MS,
    ChainType,
    DEFAULT_FEE_INCREASE,
    DOGE_DUST_AMOUNT,
    DOGE_FEE_SECURITY_MARGIN,
    DOGE_LEDGER_CLOSE_TIME_MS,
    UTXO_INPUT_SIZE,
    UTXO_INPUT_SIZE_SEGWIT,
    UTXO_OUTPUT_SIZE, UTXO_OUTPUT_SIZE_SEGWIT,
    UTXO_OVERHEAD_SIZE, UTXO_OVERHEAD_SIZE_SEGWIT,
} from "../utils/constants";
import BN from "bn.js";
import { toBN, toBNExp } from "../utils/bnutils";
import { getDefaultFeePerKB } from "../utils/utils";
import * as bitcore from "bitcore-lib";
import dogecore from "bitcore-lib-doge";
import { TransactionEntity, TransactionStatus } from "../entity/transaction";
import { RequiredEntityData } from "@mikro-orm/core";
import { UTXOWalletImplementation } from "./UTXOWalletImplementation";

/*
 * FEE CALCULATION
 */

/**
 * @returns default fee per byte
 */
export async function getFeePerKB(client: UTXOWalletImplementation): Promise<BN> {
    if (client.feeService) {
        const feeStats = await client.feeService.getLatestFeeStats();
        if (feeStats.decilesFeePerKB.length == 11) { // In testDOGE there's a lot of blocks with empty deciles and 0 avg fee
            return feeStats.decilesFeePerKB[client.feeDecileIndex].muln(client.feeIncrease ?? DEFAULT_FEE_INCREASE);
        } else if (feeStats.averageFeePerKB.gtn(0)) {
            return feeStats.averageFeePerKB.muln(client.feeIncrease ?? DEFAULT_FEE_INCREASE);
        }
    }
    return await getCurrentFeeRate(client);
}

export async function getEstimateFee(client: UTXOWalletImplementation, inputLength: number, outputLength: number = 2): Promise<BN> {
    const feePerKb = await getFeePerKB(client);
    const feePerb = feePerKb.divn(1000);
    if (client.chainType === ChainType.DOGE || client.chainType === ChainType.testDOGE) {
        return feePerb.muln(inputLength * UTXO_INPUT_SIZE + outputLength * UTXO_OUTPUT_SIZE + UTXO_OVERHEAD_SIZE);
    } else {
        return feePerb.muln(inputLength * UTXO_INPUT_SIZE_SEGWIT + outputLength * UTXO_OUTPUT_SIZE_SEGWIT + UTXO_OVERHEAD_SIZE_SEGWIT);
    }
}

// Util for bitcore-lib serialization checks
export function hasTooHighOrLowFee(chainType: ChainType, fee: BN, estFee: BN) {
    // https://github.com/bitpay/bitcore/blob/35b6f07bf33f79c0cd198a25c94ba63905b03a5f/packages/bitcore-lib/lib/transaction/transaction.js#L267
    if (chainType == ChainType.BTC || chainType == ChainType.testBTC) {
        return fee.lt(estFee.divn(BTC_FEE_SECURITY_MARGIN)) || fee.gt(estFee.muln(BTC_FEE_SECURITY_MARGIN));
    } else {
        return fee.lt(estFee.divn(DOGE_FEE_SECURITY_MARGIN)) || fee.gt(estFee.muln(DOGE_FEE_SECURITY_MARGIN));
    }
}

export async function getCurrentFeeRate(client: UTXOWalletImplementation, nextBlocks: number = 2): Promise<BN> {
    try {
        const fee = await client.blockchainAPI.getCurrentFeeRate(nextBlocks);
        const rateInSatoshies = toBNExp(fee, BTC_DOGE_DEC_PLACES);
        return rateInSatoshies.muln(client.feeIncrease ?? DEFAULT_FEE_INCREASE);
    } catch (e) {
        logger.error(`Cannot obtain fee rate ${e}`);
        return getDefaultFeePerKB(client.chainType);
    }
}

export function checkIfFeeTooHigh(fee: BN, maxFee?: BN | null): boolean {
    if (maxFee && fee.gt(maxFee)) {
        return true;
    }
    return false;
}

/*
 * COMMON UTILS
 */

export function getDefaultBlockTime(chainType: ChainType): number {
    if (chainType === ChainType.DOGE || chainType === ChainType.testDOGE) {
        return DOGE_LEDGER_CLOSE_TIME_MS;
    } else {
        return BTC_LEDGER_CLOSE_TIME_MS;
    }
}

export async function checkUTXONetworkStatus(client: UTXOWalletImplementation): Promise<boolean> {
    //TODO - maybe can be more robust if also take into account response
    try {
        await client.blockchainAPI.getCurrentBlockHeight();
        return true;
    } catch (error) {
        logger.error(`Cannot get response from server ${error}`);
        return false;
    }
}

export function getCore(chainType: ChainType): typeof bitcore {
    if (chainType === ChainType.DOGE || chainType === ChainType.testDOGE) {
        return dogecore;
    } else {
        return bitcore;
    }
}

export function getDustAmount(chainType: ChainType): BN {
    if (chainType === ChainType.DOGE || chainType === ChainType.testDOGE) {
        return DOGE_DUST_AMOUNT;
    } else {
        return BTC_DUST_AMOUNT;
    }
}

export function getEstimatedNumberOfOutputs(amountInSatoshi: BN | null, note?: string) {
    if (amountInSatoshi == null && note) return 2; // destination and note
    if (amountInSatoshi == null && !note) return 1; // destination
    if (note) return 3; // destination, change (returned funds) and note
    return 2; // destination and change
}

export async function checkIfShouldStillSubmit(client: UTXOWalletImplementation, executeUntilBlock?: number, executeUntilTimestamp?: number): Promise<boolean> {
    const currentBlockHeight = await client.blockchainAPI.getCurrentBlockHeight();
    if (executeUntilBlock && currentBlockHeight - executeUntilBlock > client.executionBlockOffset ||
        executeUntilTimestamp && new Date().getTime() - executeUntilTimestamp > client.executionBlockOffset * getDefaultBlockTime(client.chainType)) { //TODO-urska (is this good estimate?)
        return false;
    }
    return true;
}

// I think we need this only for the start, when we don't know the
export async function getTransactionEntityByHash(client: UTXOWalletImplementation, txHash: string) {

    let txEnt = await client.rootEm.findOne(TransactionEntity, { transactionHash: txHash }, { populate: ["inputs"] });
    if (!txEnt) {
        const tr = await client.blockchainAPI.getTransaction(txHash);
        logger.warn(`Tx not in db, fetched from api: ${tr}`);
        if (tr) {
            const txEnt = client.rootEm.create(TransactionEntity, {
                chainType: client.chainType,
                source: tr.data.vin[0].addresses[0] ?? "FETCHED_VIA_API_UNKNOWN_SOURCE",
                destination: "FETCHED_VIA_API_UNKNOWN_DESTINATION",
                transactionHash: txHash,
                fee: toBN(tr.data.fees ?? tr.data.fee),
                status: tr.data.blockHash ? TransactionStatus.TX_SUCCESS : TransactionStatus.TX_SUBMITTED,
            } as RequiredEntityData<TransactionEntity>);

            const inputs =
                tr.data.vin.map((t: any) => createTransactionOutputEntity(txEnt!, txHash, t.value, t.vout, t.hex));
            txEnt.inputs.add(inputs);

            await client.rootEm.persistAndFlush(txEnt);
            await client.rootEm.persistAndFlush(inputs);
        }

        txEnt = await client.rootEm.findOne(TransactionEntity, { transactionHash: txHash }, { populate: ["inputs"] });
    }

    return txEnt;
}

export async function getNumberOfAncestorsInMempool(client: UTXOWalletImplementation, txHash: string): Promise<number> {
    const txEnt = await getTransactionEntityByHash(client, txHash);
    if (!txEnt || txEnt.status === TransactionStatus.TX_SUCCESS) {
        return 0;
    } else {
        let numAncestorsInMempool = 1;
        for (const input of txEnt.inputs.getItems()) {
            numAncestorsInMempool += await getNumberOfAncestorsInMempool(client, input.transactionHash);
        }
        return numAncestorsInMempool;
    }
}