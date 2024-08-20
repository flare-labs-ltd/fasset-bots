import { TransactionInfo, type WriteWalletInterface } from "../../src/interfaces/IWalletTransaction";
import { TransactionEntity, TransactionStatus } from "../../src/entity/transaction";
import { sleepMs } from "../../src/utils/utils";
import { ChainType } from "../../src/utils/constants";
import { EntityManager, RequiredEntityData } from "@mikro-orm/core";
import { WALLET } from "../../src";
import BN from "bn.js";
import { fetchTransactionEntityById, getTransactionInfoById, updateMonitoringState } from "../../src/db/dbutils";
import { UTXOEntity } from "../../src/entity/utxo";
import { WalletAddressEntity } from "../../src/entity/wallet";
import winston from "winston";
import { logger } from "../../src/utils/logger";
import { AxiosRequestConfig, AxiosResponse, InternalAxiosRequestConfig } from "axios";
import { isORMError } from "../../src/chain-clients/utils";
import { toBN } from "../../src/utils/bnutils";

function checkStatus(tx: TransactionInfo | TransactionEntity, allowedEndStatuses: TransactionStatus[]): boolean;
function checkStatus(tx: TransactionInfo | TransactionEntity, allowedEndStatuses: TransactionStatus[], notAllowedEndStatuses: TransactionStatus[]): boolean;
function checkStatus(tx: TransactionInfo | TransactionEntity, allowedEndStatuses: TransactionStatus[], notAllowedEndStatuses?: TransactionStatus[]): boolean {
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

async function loop(sleepIntervalMs: number, timeLimit: number, tx: TransactionEntity | TransactionInfo | null, conditionFn: any) {
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
 * @param orm
 * @param status
 * @param txId
 */
async function waitForTxToFinishWithStatus(sleepInterval: number, timeLimit: number, rootEm: EntityManager, status: TransactionStatus, txId: number): Promise<[TransactionEntity, TransactionInfo]> {
    let tx = await fetchTransactionEntityById(rootEm, txId);
    await loop(sleepInterval * 1000, timeLimit * 1000, tx,async () => {
        try {
            rootEm.clear();
            tx = await fetchTransactionEntityById(rootEm, txId);
            return checkStatus(tx, [status]);
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

async function waitForTxToBeReplacedWithStatus(sleepInterval: number, timeLimit: number, wClient: WALLET.XRP | WALLET.BTC | WALLET.DOGE, status: TransactionStatus, txId: number): Promise<[TransactionEntity, TransactionInfo]> {
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

function createTransactionEntity(
    rootEm: EntityManager,
    chainType: ChainType,
    source: string,
    destination: string,
    amountInDrops: BN | null,
    feeInDrops?: BN,
    note?: string,
    maxFee?: BN,
    executeUntilBlock?: number,
    executeUntilTimestamp?: number
) {
    return rootEm.create(
        TransactionEntity,
        {
            chainType,
            source,
            destination,
            status: TransactionStatus.TX_CREATED,
            maxFee: maxFee || null,
            executeUntilBlock: executeUntilBlock || null,
            executeUntilTimestamp: executeUntilTimestamp || null,
            reference: note || null,
            amount: amountInDrops,
            fee: feeInDrops || null
        } as RequiredEntityData<TransactionEntity>,
    );
}

async function createAndSignXRPTransactionWithStatus(wClient: WALLET.XRP, source: string, target: string, amount: BN, note: string, fee: BN, status: TransactionStatus) {
    const transaction = await wClient.preparePaymentTransaction(
        source,
        target,
        amount,
        fee,
        note,
    );

    const txEnt = createTransactionEntity(wClient.rootEm, ChainType.testXRP, source, target, amount, fee, note, undefined, transaction.LastLedgerSequence);
    const privateKey = await wClient.walletKeys.getKey(txEnt.source);
    txEnt.raw = Buffer.from(JSON.stringify(transaction));
    txEnt.transactionHash = (await wClient.signTransaction(JSON.parse(txEnt.raw!.toString()), privateKey!)).txHash;
    txEnt.status = status;

    await wClient.rootEm.flush();
    return txEnt;
}

async function clearTransactions(rootEm: EntityManager) {
    await rootEm.nativeDelete(TransactionEntity, {});
    await rootEm.flush();
}

async function clearUTXOs(rootEm: EntityManager) {
    await rootEm.nativeDelete(UTXOEntity, {});
    await rootEm.flush();
}

async function updateWalletInDB(rootEm: EntityManager, address: string, modify: (walletEnt: WalletAddressEntity) => Promise<void>) {
    await rootEm.transactional(async (em) => {
        const ent = await rootEm.findOneOrFail(WalletAddressEntity, {'address': address});
        await modify(ent);
        await em.persistAndFlush(ent);
    });
}

async function setWalletStatusInDB(rootEm: EntityManager, address: string, isDeleting: boolean) {
    await updateWalletInDB(rootEm, address, async walletEnt => {
        walletEnt.isDeleting = isDeleting;
    });
}

async function setMonitoringStatus(rootEm: EntityManager, chainType: ChainType, monitoring: number) {
    await updateMonitoringState(rootEm, chainType, async (monitoringEnt) => {
        monitoringEnt.lastPingInTimestamp = toBN(monitoring);
    });
}

function addConsoleTransportForTests (logger: any) {
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

function resetMonitoringOnForceExit<T extends WriteWalletInterface>(wClient: T) {
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

function addRequestTimers(wClient: WALLET.DOGE | WALLET.BTC) {
    interface AxiosRequestConfigWithMetadata extends AxiosRequestConfig {
        metadata?: {
            startTime: Date;
        };
    }

    wClient.blockchainAPI.client.interceptors.request.use((config: InternalAxiosRequestConfig) => {
        (config as AxiosRequestConfigWithMetadata).metadata = { startTime: new Date() };
        return config;
    }, error => {
        return Promise.reject(error);
    });

    wClient.blockchainAPI.client.interceptors.response.use((response: AxiosResponse) => {
        const config = response.config as AxiosRequestConfigWithMetadata;

        if (config.metadata?.startTime) {
            const endTime = new Date();
            const duration = endTime.getTime() - config.metadata.startTime.getTime();

            logger.info(`Request to ${config.url} took ${duration} ms`);
        }

        return response;
    }, error => {
        const config = error.config as AxiosRequestConfigWithMetadata;

        if (config?.metadata?.startTime) {
            const endTime = new Date();
            const duration = endTime.getTime() - config.metadata.startTime.getTime();

            logger.info(`Request to ${config.url} failed after ${duration} ms`);
        }

        return Promise.reject(error);
    });
}

async function calculateNewFeeForTx(txId: number, feePerKb: BN, core: any, rootEm: EntityManager) {
    const txEnt = await fetchTransactionEntityById(rootEm, txId);
    const tr = new core.Transaction(JSON.parse(txEnt.raw!.toString()));
    return [txEnt.fee, tr.feePerKb(feePerKb).getFee()];
}

const END_STATUSES = [TransactionStatus.TX_REPLACED, TransactionStatus.TX_FAILED, TransactionStatus.TX_SUBMISSION_FAILED, TransactionStatus.TX_SUCCESS];
const TEST_WALLET_XRP = {
    address: "rpZ1bX5RqATDiB7iskGLmspKLrPbg5X3y8"
}

export {
    checkStatus,
    loop,
    waitForTxToFinishWithStatus,
    waitForTxToBeReplacedWithStatus,

    createTransactionEntity,
    createAndSignXRPTransactionWithStatus,
    calculateNewFeeForTx,

    clearTransactions,
    clearUTXOs,

    setWalletStatusInDB,
    setMonitoringStatus,

    addConsoleTransportForTests,
    resetMonitoringOnForceExit,
    addRequestTimers,

    TEST_WALLET_XRP,
    END_STATUSES
}