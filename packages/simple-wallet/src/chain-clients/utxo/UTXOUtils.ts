import { logger } from "../../utils/logger";
import {
    BTC_DEFAULT_FEE_PER_KB,
    BTC_DUST_AMOUNT,
    BTC_LEDGER_CLOSE_TIME_MS,
    BTC_MAINNET,
    BTC_MAX_ALLOWED_FEE,
    BTC_MIN_ALLOWED_AMOUNT_TO_SEND,
    BTC_MIN_ALLOWED_FEE,
    BTC_TESTNET,
    ChainType,
    DOGE_DEFAULT_FEE_PER_KB,
    DOGE_DUST_AMOUNT,
    DOGE_LEDGER_CLOSE_TIME_MS,
    DOGE_MAINNET,
    DOGE_MIN_ALLOWED_AMOUNT_TO_SEND,
    DOGE_TESTNET,
    UTXO_OUTPUT_SIZE,
    UTXO_OUTPUT_SIZE_SEGWIT,
} from "../../utils/constants";
import BN from "bn.js";
import { toBN } from "../../utils/bnutils";
import * as bitcore from "bitcore-lib";
import dogecore from "bitcore-lib-doge";
import { TransactionEntity } from "../../entity/transaction";
import { EntityManager } from "@mikro-orm/core";
import { UTXOWalletImplementation } from "../implementations/UTXOWalletImplementation";
import { UTXOEntity } from "../../entity/utxo";
import { ServiceRepository } from "../../ServiceRepository";
import { BlockchainAPIWrapper } from "../../blockchain-apis/UTXOBlockchainAPIWrapper";
import { errorMessage } from "../../utils/axios-error-utils";

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

export function getMinAmountToSend(chainType: ChainType): BN {
    if (chainType === ChainType.DOGE || chainType === ChainType.testDOGE) {
        return DOGE_MIN_ALLOWED_AMOUNT_TO_SEND;
    } else {
        return BTC_MIN_ALLOWED_AMOUNT_TO_SEND;
    }
}

export async function checkUTXONetworkStatus(client: UTXOWalletImplementation): Promise<boolean> {
    try {
        await ServiceRepository.get(client.chainType, BlockchainAPIWrapper).getCurrentBlockHeight();
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

export function getEstimatedNumberOfOutputs(amountInSatoshi: BN | null, note?: string) {
    if (amountInSatoshi == null && note) return 2; // destination and note
    if (amountInSatoshi == null && !note) return 1; // destination
    if (note) return 3; // destination, change (returned funds) and note
    return 2; // destination and change
}

export async function getTransactionDescendants(em: EntityManager, txHash: string, address: string): Promise<TransactionEntity[]> {
    const utxos = await em.find(UTXOEntity, { mintTransactionHash: txHash, source: address });
    const descendants = await em.find(TransactionEntity, { utxos: { $in: utxos } }, { populate: ["utxos"] });
    let sub: any[] = descendants;
    for (const descendant of descendants) {
        if (descendant.transactionHash) {
            sub = sub.concat(await getTransactionDescendants(em, descendant.transactionHash, address));
        }
    }
    return sub;
}

export async function getAccountBalance(chainType: ChainType, account: string, otherAddresses?: string[]): Promise<BN> {
    try {
        const blockchainAPIWrapper = ServiceRepository.get(chainType, BlockchainAPIWrapper);
        const accountBalance = await blockchainAPIWrapper.getAccountBalance(account);
        if (accountBalance === undefined) {
            throw new Error("Account balance not found");
        }
        const mainAccountBalance = toBN(accountBalance);
        if (!otherAddresses) {
            return mainAccountBalance;
        } else {
            const balancePromises = otherAddresses.map((address) => blockchainAPIWrapper.getAccountBalance(address));
            const balanceResponses = await Promise.all(balancePromises);
            const totalAddressesBalance = balanceResponses.reduce((sum, balance) => {
                return balance !== undefined ? sum! + balance : balance;
            }, 0);
            return toBN(totalAddressesBalance!).add(mainAccountBalance);
        }
    } catch (error) {
        logger.error(`Cannot get account balance for ${account} and other addresses ${otherAddresses}: ${errorMessage(error)}`);
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

export function isEnoughUTXOs(utxos: UTXOEntity[], amount: BN, fee?: BN): boolean {
    const disposableAmount = utxos.reduce((acc: BN, utxo: UTXOEntity) => acc.add(utxo.value), new BN(0));
    return disposableAmount
        .sub(fee ?? new BN(0))
        .sub(amount)
        .gten(0);
}

export function getCurrentNetwork(chainType: ChainType) {
    switch (chainType) {
        case ChainType.BTC:
            return BTC_MAINNET;
        case ChainType.testBTC:
            return BTC_TESTNET;
        case ChainType.DOGE:
            return DOGE_MAINNET;
        case ChainType.testDOGE:
            return DOGE_TESTNET;
        default:
            throw new Error(`Unsupported chain type ${chainType}`);
    }
}

// as in attestaion
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
        case ChainType.testBTC:
            return toBN(BTC_DEFAULT_FEE_PER_KB); // 0.0001 BTC ; in library 0.001 BTC https://github.com/bitpay/bitcore/blob/d09a9a827ea7c921e7f1e556ace37ea834a40422/packages/bitcore-lib/lib/transaction/transaction.js#L83
        case ChainType.DOGE:
        case ChainType.testDOGE:
            return toBN(DOGE_DEFAULT_FEE_PER_KB); // 1 DOGE //https://github.com/bitpay/bitcore/blob/d09a9a827ea7c921e7f1e556ace37ea834a40422/packages/bitcore-lib-doge/lib/transaction/transaction.js#L87
        default:
            throw new Error(`Unsupported chain type ${chainType}`);
    }
}

export function enforceMinimalAndMaximalFee(chainType: ChainType, feePerKB: BN): BN {
    if (chainType == ChainType.DOGE || chainType == ChainType.testDOGE) {
        return feePerKB;
    } else {
        const minFee = BTC_MIN_ALLOWED_FEE;
        const maxFee = BTC_MAX_ALLOWED_FEE;
        if (feePerKB.lt(minFee)) {
            return minFee;
        } else if (feePerKB.gt(maxFee)) {
            return maxFee;
        }
        else {
            return feePerKB;
        }
    }
}