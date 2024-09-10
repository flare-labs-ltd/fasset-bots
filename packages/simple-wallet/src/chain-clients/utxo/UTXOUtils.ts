import { logger } from "../../utils/logger";
import {
    BTC_DUST_AMOUNT,
    BTC_LEDGER_CLOSE_TIME_MS,
    ChainType,
    DOGE_DUST_AMOUNT,
    DOGE_LEDGER_CLOSE_TIME_MS,
} from "../../utils/constants";
import BN from "bn.js";
import { toBN } from "../../utils/bnutils";
import * as bitcore from "bitcore-lib";
import dogecore from "bitcore-lib-doge";
import { TransactionEntity } from "../../entity/transaction";
import { EntityManager } from "@mikro-orm/core";
import { UTXOWalletImplementation } from "./UTXOWalletImplementation";
import { UTXOEntity } from "../../entity/utxo";
import { errorMessage } from "../utils";
import { ServiceRepository } from "../../ServiceRepository";
import { BlockchainAPIWrapper } from "../../blockchain-apis/BlockchainAPIWrapper";

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
        await ServiceRepository.get(BlockchainAPIWrapper).getCurrentBlockHeight();
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

export async function checkIfShouldStillSubmit(chainType: ChainType, executionBlockOffset: number, executeUntilBlock?: number, executeUntilTimestamp?: Date): Promise<boolean> {
    const currentBlockHeight = await ServiceRepository.get(BlockchainAPIWrapper).getCurrentBlockHeight();
    const blockRestriction = !!executeUntilBlock && (currentBlockHeight.number - executeUntilBlock > executionBlockOffset);
    // It probably should be following, but due to inconsistent blocktime on btc, we use currentTime
    //const timeRestriction = executeUntilTimestamp && currentBlockHeight.timestamp - executeUntilTimestamp > executionBlockOffset * getDefaultBlockTime(client)
    const timeRestriction = !!executeUntilTimestamp && (new Date().getTime() - executeUntilTimestamp?.getTime() > executionBlockOffset * getDefaultBlockTime(chainType)); //TODO-urska (is this good estimate
    if (executeUntilBlock && !executeUntilTimestamp && blockRestriction) {
        return false;
    } else if (!executeUntilBlock && executeUntilTimestamp && timeRestriction) {
        return false;
    } else if (blockRestriction && timeRestriction) {
        return false;
    }
    return true;
}


export async function getTransactionDescendants(em: EntityManager, txHash: string, address: string): Promise<TransactionEntity[]> {
    // TODO If this proves to be to slow MySQL has CTE for recursive queries ...
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

export async function getAccountBalance(account: string, otherAddresses?: string[]): Promise<BN> {
    try {
        const accountBalance = await ServiceRepository.get(BlockchainAPIWrapper).getAccountBalance(account);
        if (!accountBalance) {
            throw new Error("Account balance not found");
        }
        const mainAccountBalance = toBN(accountBalance);
        if (!otherAddresses) {
            return mainAccountBalance;
        } else {
            const balancePromises = otherAddresses.map(address => ServiceRepository.get(BlockchainAPIWrapper).getAccountBalance(address));
            const balanceResponses = await Promise.all(balancePromises);
            const totalAddressesBalance = balanceResponses.reduce((sum, balance) => {
                return balance ? sum! + balance : balance;
            }, 0);
            return toBN(totalAddressesBalance!).add(mainAccountBalance);
        }
    } catch (error) {
        logger.error(`Cannot get account balance for ${account} and other addresses ${otherAddresses}: ${errorMessage(error)}`);
        throw error;
    }
}