import {logger} from "../../utils/logger";
import {
    BTC_DEFAULT_FEE_PER_KB, BTC_DOGE_DEC_PLACES,
    BTC_DUST_AMOUNT,
    BTC_LEDGER_CLOSE_TIME_MS,
    BTC_MIN_ALLOWED_AMOUNT_TO_SEND,
    BTC_MIN_ALLOWED_FEE_PER_KB,
    ChainType,
    DOGE_DEFAULT_FEE_PER_KB,
    DOGE_DUST_AMOUNT,
    DOGE_LEDGER_CLOSE_TIME_MS,
    DOGE_MIN_ALLOWED_AMOUNT_TO_SEND,
    DOGE_MIN_ALLOWED_FEE_PER_KB,
    TEST_BTC_DEFAULT_FEE_PER_KB,
    UTXO_OUTPUT_SIZE,
    UTXO_OUTPUT_SIZE_SEGWIT,
} from "../../utils/constants";
import BN from "bn.js";
import { toBN, toBNExp } from "../../utils/bnutils";
import * as bitcore from "bitcore-lib";
import dogecore from "bitcore-lib-doge";
import {TransactionEntity} from "../../entity/transaction";
import {EntityManager} from "@mikro-orm/core";
import {UTXOWalletImplementation} from "../implementations/UTXOWalletImplementation";
import {errorMessage} from "../../utils/axios-utils";
import {UTXOBlockchainAPI} from "../../blockchain-apis/UTXOBlockchainAPI";
import {TransactionInputEntity} from "../../entity/transactionInput";
import {fetchTransactionEntityById} from "../../db/dbutils";
import { MempoolUTXO } from "../../interfaces/IBlockchainAPI";
import { TransactionData } from "../../interfaces/IWalletTransaction";

/*
 * COMMON UTILS
 */

export function getDefaultBlockTimeInSeconds(chainType: ChainType): number {
    if (chainType === ChainType.DOGE || chainType === ChainType.testDOGE) {
        return DOGE_LEDGER_CLOSE_TIME_MS / 1000;
    } else {
        return BTC_LEDGER_CLOSE_TIME_MS / 1000;
    }
}

/* istanbul ignore next */
export async function checkUTXONetworkStatus(client: UTXOWalletImplementation): Promise<boolean> {
    try {
        await client.blockchainAPI.getCurrentBlockHeight();
        return true;
    } catch (error) {
        logger.error(`Cannot get response from server ${errorMessage(error)}`);
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

export async function getTransactionDescendants(em: EntityManager, txId: number): Promise<TransactionEntity[]> {
    const txEnt = await fetchTransactionEntityById(em, txId);
    if (txEnt.numberOfOutputs === 0) {
        return [];
    }

    const condition = Array.from({ length: txEnt.numberOfOutputs }, (_, i) => ({
        transactionHash: txEnt.transactionHash,
        vout: i
    }));

    const inputs = (await em.find(TransactionInputEntity, {
        $or: condition
    })) as TransactionInputEntity[];

    const descendants = await em.find(TransactionEntity, {
        inputs: {
            $in: inputs
        },
        chainType: txEnt.chainType,
    });

    let res: TransactionEntity[] = descendants;
    for (const descendant of descendants) {
        /* istanbul ignore next */
        if (descendant.transactionHash) {
            res = res.concat(await getTransactionDescendants(em, descendant.id));
        }
    }

    return res;
}

export async function getAccountBalance(blockchainAPI: UTXOBlockchainAPI, account: string): Promise<BN> {
    try {
        const balance = await blockchainAPI.getAccountBalance(account);
        const mainAccountBalance = toBN(balance);
        return mainAccountBalance;
    } catch (error) /* istanbul ignore next */ {
        logger.error(`Cannot get account balance for ${account}: ${errorMessage(error)}`);
        throw error;
    }
}

export function getOutputSize(chainType: ChainType) {
    if (chainType === ChainType.DOGE || chainType === ChainType.testDOGE) {
        return UTXO_OUTPUT_SIZE;
    } else {
        return UTXO_OUTPUT_SIZE_SEGWIT;
    }
}

export function isEnoughUTXOs(utxos: MempoolUTXO[], txData: TransactionData): boolean {
    const disposableAmount = utxos.reduce((acc: BN, utxo: MempoolUTXO) => acc.add(utxo.value), new BN(0));
    const enough = disposableAmount.sub(txData.fee ?? new BN(0)).sub(txData.amount).gten(0);
    if (enough === true) {
        return true;
    } else {
        logger.info(`Account ${txData.source} doesn't have enough UTXOs - Skipping selection.
            Amount: ${txData.amount.toNumber()},
            UTXO values: [${utxos.map(t => t.value.toNumber()).join(', ')}],
            ${txData.fee ? "fee" : "feePerKB"}: ${txData.fee?.toNumber() ?? txData.feePerKB?.toNumber()}`
        );
        return false;
    }
}

// as in attestation
export function getConfirmedAfter(chainType: ChainType): number {
    switch (chainType) {
        case ChainType.BTC:
        case ChainType.testBTC:
            return 6;
        case ChainType.DOGE:
        case ChainType.testDOGE:
            return 60;
        default:
            throw new Error(`Unsupported chain type ${chainType}`);
    }
}

export function getDefaultFeePerKB(chainType: ChainType): BN {
    switch (chainType) {
        case ChainType.BTC:
            logger.warn(`Fetching default fee for chain type ${chainType}: ${BTC_DEFAULT_FEE_PER_KB.toString()}`)
            return toBN(BTC_DEFAULT_FEE_PER_KB);
        case ChainType.testBTC:
            logger.warn(`Fetching default fee for chain type ${chainType}: ${TEST_BTC_DEFAULT_FEE_PER_KB.toString()}`)
            return toBN(TEST_BTC_DEFAULT_FEE_PER_KB);
        case ChainType.DOGE:
        case ChainType.testDOGE:
            logger.warn(`Fetching default fee for chain type ${chainType}: ${DOGE_DEFAULT_FEE_PER_KB.toString()}`)
            return toBN(DOGE_DEFAULT_FEE_PER_KB);
        default:
            throw new Error(`Unsupported chain type ${chainType}`);
    }
}

export function enforceMinimalAndMaximalFee(chainType: ChainType, feePerKB: BN): BN {
    const minAllowedFee = getMinimalAllowedFeePerKB(chainType);
    if (feePerKB.lt(minAllowedFee)) {
        return minAllowedFee;
    } else {
        return feePerKB;
    }
}

export function utxoOnly(chainType: ChainType) {
    if (chainType === ChainType.BTC || chainType === ChainType.testBTC ||
        chainType === ChainType.DOGE || chainType === ChainType.testDOGE
    ) {
        return true;
    } else {
        return false;
    }
}

export function getRelayFeePerKB(chainType: ChainType) {
    if (chainType === ChainType.BTC || chainType === ChainType.testBTC) {
        return toBN(1000);
    } else if (chainType === ChainType.DOGE || chainType === ChainType.testDOGE) {
        return toBNExp(0.001, BTC_DOGE_DEC_PLACES); // The default minimum transaction fee for relay is set at 0.001 DOGE/kB: https://github.com/dogecoin/dogecoin/blob/master/doc/fee-recommendation.md
    }
    throw Error(`getRelayFeePerKB executed for unknown chain: ${chainType}`);
}

export function getMinimumUsefulUTXOValue(chainType: ChainType) {
    switch (chainType) {
        case ChainType.BTC:
        case ChainType.testBTC:
            return BTC_MIN_ALLOWED_AMOUNT_TO_SEND;
        case ChainType.DOGE:
        case ChainType.testDOGE:
            return DOGE_MIN_ALLOWED_AMOUNT_TO_SEND;
        default:
            throw new Error(`Unsupported chain type ${chainType}`);
    }
}

export function getMinimumAllowedUTXOValue(chainType: ChainType) {
    return getDustAmount(chainType).muln(2);
}

export function calculateFeePerKBFromTransactionEntity(rbfTxId: number, txForReplacement?: TransactionEntity) : BN {
    if (txForReplacement && txForReplacement.fee && txForReplacement.size) {
        return txForReplacement.fee.muln(1000).divn(txForReplacement.size);
    } else if (txForReplacement) {
        logger.warn(`RBF transaction ${rbfTxId} cannot determine original feePerKb. Missing fee and size.`)
        return toBN(0);
    } else {
        return toBN(0);
    }
}

export function getMinimalAllowedFeePerKB(chainType: ChainType): BN {
    if (chainType == ChainType.DOGE || chainType == ChainType.testDOGE) {
        return DOGE_MIN_ALLOWED_FEE_PER_KB;
    } else {
        return BTC_MIN_ALLOWED_FEE_PER_KB;
    }
}

// Rearranges and sorts UTXO arrays based on their total value's difference from the target amount; filtering out arrays that don't meet the target.
export function rearrangeUTXOs(arraysToArrange: MempoolUTXO[][], orderByDesc: boolean, targetAmount: BN): MempoolUTXO[][] {
    const arraysWithDiff = arraysToArrange.map((array) => {
        const sum = array.reduce((sum, utxo) => sum.add(utxo.value), toBN(0));
        const diff = sum.sub(targetAmount);
        return { array, sum, diff };
    });
    const validArraysWithDiff = arraysWithDiff.filter(item => item.diff.gte(toBN(0)));
    validArraysWithDiff.sort((a, b) => {
        if (orderByDesc) {
            return a.diff.lt(b.diff) ? -1 : 1
        } else {
            return a.diff.gt(b.diff) ? -1 : 1;
        }
    });

    return validArraysWithDiff.map(item => (item.array));
}