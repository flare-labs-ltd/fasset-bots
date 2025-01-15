import { BaseWalletConfig, ITransactionMonitor, TransactionInfo } from "../../src";
import { TransactionEntity, TransactionStatus } from "../../src";
import { sleepMs } from "../../src/utils/utils";
import { ChainType } from "../../src/utils/constants";
import { EntityManager } from "@mikro-orm/core";
import {BTC, decryptText, DOGE, XRP} from "../../src";
import { fetchTransactionEntityById } from "../../src/db/dbutils";
import winston, { Logger } from "winston";
import { logger } from "../../src";
import { toBN } from "../../src/utils/bnutils";
import { isORMError } from "../../src";
import {
    AccountBalanceResponse,
    MempoolUTXO,
    UTXORawTransaction,
    UTXORawTransactionInput,
    UTXOTransactionResponse,
} from "../../src/interfaces/IBlockchainAPI";
import { UTXOBlockchainAPI } from "../../src/blockchain-apis/UTXOBlockchainAPI";
import { AxiosInstance, AxiosResponse } from "axios";
import {read} from "read";
import fs from "fs";
import { UTXOWalletImplementation } from "../../src/chain-clients/implementations/UTXOWalletImplementation";
const bitcore = require('bitcore-lib');

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
export async function waitForTxToFinishWithStatus(sleepInterval: number, timeLimit: number, rootEm: EntityManager, status: TransactionStatus | TransactionStatus[], txId: number): Promise<TransactionEntity> {
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

    return fetchTransactionEntityById(rootEm, txId)
}

export async function waitForTxToBeReplacedWithStatus(sleepInterval: number, timeLimit: number, wClient: XRP | BTC | DOGE, status: TransactionStatus, txId: number): Promise<TransactionEntity> {
    let txInfo = await wClient.getTransactionInfo(txId);
    let replacedTx: TransactionEntity | TransactionInfo | null = null;

    await loop(sleepInterval * 1000, timeLimit * 1000, txInfo, async () => {
        txInfo = await wClient.getTransactionInfo(txId);
        if (txInfo.replacedByDdId)
            replacedTx = await fetchTransactionEntityById(wClient.rootEm, txInfo.replacedByDdId);
        if (replacedTx)
            return checkStatus(replacedTx, [status]);
    });

    return fetchTransactionEntityById(wClient.rootEm, txId);
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

export async function promptPassword(message?: string): Promise<string> {
    const password = await read({
        prompt: message ?? `Enter the password: `,
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

export interface AccountSecretsForStressTest {
    BTC: {
        fundedWallet: Wallet[];
        targetWallets: Wallet[];
    };
    DOGE: {
        fundedWallet: Wallet[];
        targetWallets: Wallet[];
    };
    XRP: {
        api_key: string;
        fundedWallet: Wallet[];
        targetWallets: Wallet[];
    };
}

export interface Wallet {
    address: string;
    mnemonic: string;
    private_key: string;
}


export async function walletAddressesIncludedInInputs(wClient: UTXOWalletImplementation, addressToBeFound: string, rawTx: string): Promise<boolean> {
    const tr = JSON.parse(rawTx) as UTXORawTransaction;
    for (const input of tr.inputs) {
        const txHash = input.prevTxId;
        const index = input.outputIndex;
        const transaction = await wClient.blockchainAPI.getTransaction(txHash);
        const addresses = transaction.vout[index].addresses;
        if (addresses.includes(addressToBeFound)) {
            return true;
        }
    }
    return false;
}

export async function walletAddressesIncludedInOutputs(wClient: UTXOWalletImplementation, addressToBeFound: string, rawTx: string): Promise<boolean> {
    const tr = JSON.parse(rawTx) as UTXORawTransaction;
    const script = getAddressScript(wClient.chainType, addressToBeFound);
    for (const output of tr.outputs) {
        if (output.script === script) {
            return true;
        }
    }
    return false;
}

export function getAddressScript(chainType: ChainType, address: string) {
    if (chainType === ChainType.testDOGE) {
        const dogeTestnet = bitcore.Networks.add({
            name: 'dogeTestnet',
            alias: 'dogecoin-testnet',
            pubkeyhash: 0x71,
            privatekey: 0xf1,
            scripthash: 0xc4,
            xpubkey: 0x043587cf,
            xprivkey: 0x04358394,
            networkMagic: 0xfcc1b7dc,
            port: 44556,
          });
        const addressAddress = bitcore.Address(address, dogeTestnet);
        const pubkeyHash = addressAddress.hashBuffer.toString('hex');
        const scriptPubKey = `76a914${pubkeyHash}88ac`;
        return scriptPubKey
    } else if (chainType === ChainType.testBTC) {
        const addressAddress = bitcore.Address(address, bitcore.Networks.testnet);
        if (address.startsWith("tb1")) {
            const scriptPubKey = bitcore.Script.buildWitnessV0Out(addressAddress);
            return scriptPubKey.toHex();
        } else {
            const pubkeyHash = addressAddress.hashBuffer.toString('hex');
            const scriptPubKey = `76a914${pubkeyHash}88ac`;
            return scriptPubKey;
        }
    } else {
        throw new Error("Network not supported");
    }
}