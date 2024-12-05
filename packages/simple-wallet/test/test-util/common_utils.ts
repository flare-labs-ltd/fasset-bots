import { BaseWalletConfig, ITransactionMonitor, TransactionInfo } from "../../src";
import { TransactionEntity, TransactionStatus } from "../../src";
import { sleepMs } from "../../src/utils/utils";
import { ChainType } from "../../src/utils/constants";
import { EntityManager } from "@mikro-orm/core";
import {BTC, decryptText, DOGE, XRP} from "../../src";
import { fetchTransactionEntityById, getTransactionInfoById } from "../../src/db/dbutils";
import winston, { Logger } from "winston";
import { logger } from "../../src";
import { toBN } from "../../src/utils/bnutils";
import { isORMError, tryWithClients } from "../../src";
import {
    AccountBalanceResponse,
    MempoolUTXO,
    UTXOAddressResponse,
    UTXORawTransaction,
    UTXORawTransactionInput,
    UTXOTransactionResponse,
} from "../../src/interfaces/IBlockchainAPI";
import { UTXOBlockchainAPI } from "../../src/blockchain-apis/UTXOBlockchainAPI";
import { AxiosInstance, AxiosResponse } from "axios";
import {read} from "read";
import fs from "fs";
import { UTXOWalletImplementation } from "../../src/chain-clients/implementations/UTXOWalletImplementation";

export const PASSWORD_MIN_LENGTH = 16;

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
        const calculatedNotAllowedEndStatuses = [TransactionStatus.TX_REPLACED, TransactionStatus.TX_FAILED, TransactionStatus.TX_SUBMISSION_FAILED, TransactionStatus.TX_SUCCESS].filter(t => !allowedEndStatuses.includes(t));
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
            winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
            winston.format.printf(({ timestamp, level, message }) => {
                return `[${timestamp}] ${level}: ${message}`;
            })
        ),
    });

    logger.add(consoleTransport);

    return () => {
        logger.remove(consoleTransport);
    };
}

export function resetMonitoringOnForceExit<T extends ITransactionMonitor>(wClient: T) {
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

export class MockBlockchainAPI extends UTXOBlockchainAPI {
    constructor() {
        super({urls: ["a"]} as BaseWalletConfig, ChainType.testBTC);
    }
    clients: AxiosInstance[] = [];

    getBlockTimeAt(): Promise<import("bn.js")> {
        return Promise.resolve(toBN(0));
    }

    async getAccountBalance(): Promise<AccountBalanceResponse> {
        return Promise.resolve({balance: 0, unconfirmedBalance: 0, unconfirmedTxs: 0});
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

    async findTransactionHashWithInputs(address: string, inputs: UTXORawTransactionInput[], submittedInBlock: number): Promise<string> {
        return Promise.resolve("");
    }
}

export function createNote() {
    const fixedPart = "10000000000000000000000000000000000000000";
    const randomPartLength = 64 - 41;

    let randomPart = "";
    for (let i = 0; i < randomPartLength; i++) {
        randomPart += Math.floor(Math.random() * 16).toString(16);
    }

    return fixedPart + randomPart;
}

export async function decryptTestSecrets(filePath: string, password: string) {
    const encryptedSecretsContent = fs.readFileSync(filePath).toString();
    const decryptedSecretsContent = decryptText(password, encryptedSecretsContent);
    return JSON.parse(decryptedSecretsContent);
}

export function validateEncryptionPassword(password: string) {
    if (password.length < PASSWORD_MIN_LENGTH) {
        throw new Error(`Password should be at least ${PASSWORD_MIN_LENGTH} chars long`);
    }
}

export async function promptPassword(): Promise<string> {
    const password = await read({
        prompt: `Enter the password: `,
        silent: true,
        replace: "*"
    });
    validateEncryptionPassword(password)
    return password;
}

export function isJSON(content: string): boolean {
    try {
        JSON.parse(content);
        return true;
    } catch (error) {
        return false;
    }
}

export async function createWallet(wClient: DOGE | BTC | XRP, secrets: any, walletType: "fundedWallet" | "targetWallet") {
    if (secrets[walletType].private_key) {
        await wClient.walletKeys.addKey(secrets[walletType].address, secrets[walletType].private_key);
    } else if (secrets[walletType].mnemonic) {
        const wallet = wClient.createWalletFromMnemonic(secrets[walletType].mnemonic);
        await wClient.walletKeys.addKey(wallet.address, wallet.privateKey);
    } else {
        throw new Error(`Both mnemonic and private key missing for ${walletType}`);
    }
}

export interface AccountSecrets {
    BTC: {
        fundedWallet: Wallet;
        targetWallet: Wallet;
    };
    DOGE: {
        fundedWallet: Wallet;
        targetWallet: Wallet;
    };
    XRP: {
        api_key: string;
        fundedWallet: Wallet;
        targetWallet: Wallet;
    };
}

export interface Wallet {
    address: string;
    mnemonic: string;
    private_key: string;
}


export async function bothWalletAddresses(wClient: UTXOWalletImplementation, address1: string, address2: string, rawTx: string): Promise<{address1Included: boolean[], address2Included: boolean[]}> {
    const tr = JSON.parse(rawTx) as UTXORawTransaction;
    const address1Included = await Promise.all(tr.inputs.map(t => checkIfAddressHasTransaction(wClient, address1, t.prevTxId)));
    const address2Included = await Promise.all(tr.inputs.map(t => checkIfAddressHasTransaction(wClient, address2, t.prevTxId)));
    return {address1Included,  address2Included}
}

export async function checkIfAddressHasTransaction(wClient: UTXOWalletImplementation, address: string, txHash: string): Promise<boolean> {
    return tryWithClients(wClient.blockchainAPI.clients, async (client: AxiosInstance) => {
        const firstResp = await client.get<UTXOAddressResponse>(`/address/${address}?`);
        for (let i = 0; i < firstResp.data.totalPages; i++) {
            const resp = await client.get<UTXOAddressResponse>(`/address/${address}?`);
            if (resp.data.txids.includes(txHash)) {
                return true;
            }
        }
        return false;
    }, "");
}