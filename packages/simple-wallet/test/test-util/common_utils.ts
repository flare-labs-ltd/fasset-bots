import { TransactionInfo, type WriteWalletInterface } from "../../src/interfaces/IWalletTransaction";
import { TransactionEntity, TransactionStatus } from "../../src/entity/transaction";
import { sleepMs } from "../../src/utils/utils";
import { ChainType } from "../../src/utils/constants";
import { EntityManager } from "@mikro-orm/core";
import { BTC, DOGE, XRP } from "../../src";
import BN from "bn.js";
import { fetchTransactionEntityById, getTransactionInfoById } from "../../src/db/dbutils";
import winston, { Logger } from "winston";
import { logger } from "../../src/utils/logger";
import { toBN } from "../../src/utils/bnutils";
import { isORMError } from "../../src/utils/axios-error-utils";
import { UTXOBlockchainAPI } from "../../src/blockchain-apis/UTXOBlockchainAPI";
import axios, { AxiosInstance, AxiosResponse } from "axios";
import { MempoolUTXO, UTXOTransactionResponse } from "../../src/interfaces/IBlockchainAPI";
import * as bitcore from "bitcore-lib";
import { Transaction } from "bitcore-lib";

export function checkStatus(tx: TransactionInfo | TransactionEntity, allowedEndStatuses: TransactionStatus[]): boolean;
export function checkStatus(tx: TransactionInfo | TransactionEntity, allowedEndStatuses: TransactionStatus[], notAllowedEndStatuses: TransactionStatus[]): boolean;
export function checkStatus(tx: TransactionInfo | TransactionEntity, allowedEndStatuses: TransactionStatus[], notAllowedEndStatuses?: TransactionStatus[]): boolean {
    if (notAllowedEndStatuses) {
        if (allowedEndStatuses.includes(tx.status)) {
            return true;
        } else if (notAllowedEndStatuses.includes(tx.status)) {
            throw new Error(`Exited with wrong status ${tx.status}`);
        } else {
            return false;
        }
    } else {
        const calculatedNotAllowedEndStatuses = END_STATUSES.filter(t => !allowedEndStatuses.includes(t));
        return checkStatus(tx, allowedEndStatuses, calculatedNotAllowedEndStatuses);
    }
}

export async function loop(sleepIntervalMs: number, timeLimit: number, tx: TransactionEntity | TransactionInfo | null, conditionFn: () => Promise<boolean | undefined>) {
    const startTime = Date.now();
    while (true) {
        const shouldStop = await conditionFn();
        if (shouldStop) break;
        if (Date.now() - startTime > timeLimit) {
            throw tx ?
                new Error(`Time limit exceeded for ${ tx instanceof TransactionEntity ? tx.id : tx.dbId} with ${tx.transactionHash}`) :
                new Error(`Time limit exceeded`);
        }

        await sleepMs(sleepIntervalMs);
    }
}

/**
 *
 * @param sleepInterval in seconds
 * @param timeLimit in seconds
 * @param rootEm
 * @param status
 * @param txId
 */
export async function waitForTxToFinishWithStatus(sleepInterval: number, timeLimit: number, rootEm: EntityManager, status: TransactionStatus | TransactionStatus[], txId: number): Promise<[TransactionEntity, TransactionInfo]> {
    let tx = await fetchTransactionEntityById(rootEm, txId);
    await loop(sleepInterval * 1000, timeLimit * 1000, tx,async () => {
        try {
            rootEm.clear();
            tx = await fetchTransactionEntityById(rootEm, txId);
            return checkStatus(tx, Array.isArray(status) ? status :[status]);
        } catch (error) {
            if (isORMError(error)) {
                logger.error("Test util error: ", error);
                return false;
            }
            throw error;
        }
    });

    try {
        return [await fetchTransactionEntityById(rootEm, txId), await getTransactionInfoById(rootEm, txId)];
    } catch (error) {
        logger.error("Test util error: ", error);
        await sleepMs(1000);
        return [await fetchTransactionEntityById(rootEm, txId), await getTransactionInfoById(rootEm, txId)];
    }
}

export async function waitForTxToBeReplacedWithStatus(sleepInterval: number, timeLimit: number, wClient: XRP | BTC | DOGE, status: TransactionStatus, txId: number): Promise<[TransactionEntity, TransactionInfo]> {
    let txInfo = await wClient.getTransactionInfo(txId);
    let replacedTx: TransactionEntity | TransactionInfo | null = null;

    await loop(sleepInterval * 1000, timeLimit * 1000, txInfo, async () => {
        wClient.rootEm.clear();
        txInfo = await wClient.getTransactionInfo(txId);
        if (txInfo.replacedByDdId)
            replacedTx = await fetchTransactionEntityById(wClient.rootEm, txInfo.replacedByDdId);
        if (replacedTx)
            return checkStatus(replacedTx, [status]);
    });

    return [await fetchTransactionEntityById(wClient.rootEm, txId), await wClient.getTransactionInfo(txId)];
}

export function addConsoleTransportForTests (logger: Logger) {
    const consoleTransport = new winston.transports.Console({
        format: winston.format.combine(
            winston.format.colorize(),
            winston.format.simple()
        ),
    });

    logger.add(consoleTransport);

    return () => {
        logger.remove(consoleTransport);
    };
}

export function resetMonitoringOnForceExit<T extends WriteWalletInterface>(wClient: T) {
    process.on("SIGINT", () => {
        wClient.stopMonitoring().then(() => {
            logger.info("Stopped monitoring after SIGINT")
            process.exit(process.exitCode);
        }).catch(err => {
            logger.error(err);
            process.exit(1);
        });
    });
    process.on("SIGTERM", () => {
        wClient.stopMonitoring().then(() => {
            logger.info("Stopped monitoring after SIGTERM")
            process.exit(process.exitCode);
        }).catch(err => {
            logger.error(err);
            process.exit(1);
        });
    });
    process.on("SIGQUIT", () => {
        wClient.stopMonitoring().then(() => {
            logger.info("Stopped monitoring after SIGQUIT")
            process.exit(process.exitCode);
        }).catch(err => {
            logger.error(err);
            process.exit(1);
        });
    });
    process.on("SIGHUP", () => {
        wClient.stopMonitoring().then(() => {
            logger.info("Stopped monitoring after SIGHUP")
            process.exit(process.exitCode);
        }).catch(err => {
            logger.error(err);
            process.exit(1);
        });
    });
}

export async function calculateNewFeeForTx(txId: number, feePerKb: BN, core: typeof bitcore, rootEm: EntityManager): Promise<[BN | undefined, number | undefined]> {
    const txEnt = await fetchTransactionEntityById(rootEm, txId);
    const tr: Transaction = new core.Transaction(JSON.parse(txEnt.raw!));
    return [txEnt.fee, tr.feePerKb(feePerKb.toNumber()).getFee()];
}

export const END_STATUSES = [TransactionStatus.TX_REPLACED, TransactionStatus.TX_FAILED, TransactionStatus.TX_SUBMISSION_FAILED, TransactionStatus.TX_SUCCESS];
export const TEST_WALLET_XRP = {
    address: "rpZ1bX5RqATDiB7iskGLmspKLrPbg5X3y8"
}


export class MockBlockchainAPI implements UTXOBlockchainAPI {
    client: AxiosInstance;
    clients: Record<string, AxiosInstance>;
    chainType: ChainType;

    constructor() {
        this.clients = {};
        this.client = axios.create({});
        this.chainType = ChainType.testBTC;
    }

    getBlockTimeAt(): Promise<import("bn.js")> {
        return Promise.resolve(toBN(0));
    }

    async getAccountBalance(): Promise<number | undefined> {
        return Promise.resolve(undefined);
    }

    async getCurrentBlockHeight(): Promise<number> {
        return Promise.resolve(0);
    }

    async getCurrentFeeRate(): Promise<number> {
        return Promise.resolve(0);
    }

    async getTransaction(): Promise<UTXOTransactionResponse> {
        return Promise.resolve(
            {
                "txid": "",
                "version": 0,
                "vin": [
                    {
                        "txid": "",
                        "vout": 0,
                        "sequence": 0,
                        "addresses": [
                            ""
                        ],
                        "value": "39256335"
                    }
                ],
                "vout": [
                    {
                        "value": "",
                        "n": 0,
                        "hex": "",
                        "spent": true,
                        "addresses": [
                            ""
                        ],
                    },
                    {
                        "value": "",
                        "n": 1,
                        "spent": true,
                        "hex": "",
                        "addresses": [
                            ""
                        ],
                    }
                ],
                "blockHash": "",
                "blockHeight": 0,
                "confirmations": 0,
                "blockTime": 0,
                "size": 0,
                "vsize": 0,
                "value": "",
                "valueIn": "",
                "fees": "",
                "hex": ""
            }
        );
    }

    async getUTXOScript(): Promise<string> {
        return Promise.resolve("");
    }

    async getUTXOsFromMempool(): Promise<MempoolUTXO[]> {
        return Promise.resolve([]);
    }

    async sendTransaction(): Promise<AxiosResponse> {
        return Promise.resolve({} as AxiosResponse);
    }
}