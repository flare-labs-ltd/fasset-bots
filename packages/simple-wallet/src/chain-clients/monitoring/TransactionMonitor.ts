import { EntityManager, RequiredEntityData } from "@mikro-orm/core";
import { toBN } from "web3-utils";
import { fetchMonitoringState, fetchTransactionEntities, retryDatabaseTransaction, transactional, updateMonitoringState } from "../../db/dbutils";
import { TransactionEntity, TransactionStatus } from "../../entity/transaction";
import { ChainType, MONITOR_EXPIRATION_INTERVAL, MONITOR_LOOP_SLEEP, MONITOR_PING_INTERVAL, RANDOM_SLEEP_MS_MAX, RESTART_IN_DUE_NO_RESPONSE } from "../../utils/constants";
import { logger } from "../../utils/logger";
import { getRandomInt, requireDefined, sleepMs } from "../../utils/utils";
import { utxoOnly } from "../utxo/UTXOUtils";
import { BlockchainFeeService } from "../../fee-service/fee-service";
import { MonitoringStateEntity } from "../../entity/monitoringState";
import { errorMessage } from "../../utils/axios-utils";

export interface IMonitoredWallet {
    submitPreparedTransactions(txEnt: TransactionEntity): Promise<void>;
    checkPendingTransaction(txEnt: TransactionEntity): Promise<void>;
    prepareAndSubmitCreatedTransaction(txEnt: TransactionEntity): Promise<void>;
    checkSubmittedTransaction(txEnt: TransactionEntity): Promise<void>;
    checkNetworkStatus(): Promise<boolean>;
    resubmitSubmissionFailedTransactions?(txEnt: TransactionEntity): Promise<void>;
}

class StopTransactionMonitor extends Error {}

export class TransactionMonitor {
    private monitoring = false;
    private chainType: ChainType;
    private rootEm: EntityManager;
    monitoringId: string;
    feeService: BlockchainFeeService | undefined;

    constructor(chainType: ChainType, rootEm: EntityManager, monitoringId: string, feeService?: BlockchainFeeService) {
        this.chainType = chainType;
        this.rootEm = rootEm;
        this.monitoringId = monitoringId;
        if (utxoOnly(this.chainType)) {
            this.feeService = feeService;
        }
    }

    async isMonitoring(): Promise<boolean> {
        const monitoringState = await fetchMonitoringState(this.rootEm, this.chainType);
        if (!monitoringState || monitoringState.processOwner !== this.monitoringId) {
            return false;
        }
        const elapsed = Date.now() - monitoringState.lastPingInTimestamp.toNumber();
        return elapsed < MONITOR_EXPIRATION_INTERVAL;
    }

    async startMonitoringTransactionProgress(wallet: IMonitoredWallet): Promise<void> {
        try {
            const acquiredLock = await this.waitAndAcquireMonitoringLock();
            if (!acquiredLock) return;
            // mark started
            this.monitoring = true;
            logger.info(`Monitoring started for chain ${this.monitoringId}`);
            // start pinger in the background
            void this.updatePingLoop();
            // start fee monitoring
            if (utxoOnly(this.chainType) && this.feeService) {
                await this.feeService.setupHistory();
                void this.feeService.monitorFees(this.monitoring);
            }
            // start main loop
            await this.monitoringMainLoop(wallet);
        } catch (error) {
            logger.error(`Monitoring failed for chain ${this.monitoringId} error: ${errorMessage(error)}.`);
        }
    }

    async stopMonitoring(): Promise<void> {
        if (this.monitoring) {
            logger.info(`Monitoring will stop for ${this.monitoringId} ...`);
            const monitoringState = await fetchMonitoringState(this.rootEm, this.chainType);
            if (monitoringState?.processOwner && monitoringState.processOwner === this.monitoringId) {
                this.monitoring = false;
                console.log(`Stopping wallet monitoring ${this.monitoringId} ...`);
                const randomMs = getRandomInt(0, RANDOM_SLEEP_MS_MAX);
                await sleepMs(MONITOR_PING_INTERVAL + randomMs); // to make sure pinger stops
                await retryDatabaseTransaction(`stopping monitor for chain ${this.monitoringId}`, async () => {
                    await updateMonitoringState(this.rootEm, this.chainType, (monitoringEnt) => {
                        monitoringEnt.lastPingInTimestamp = toBN(0);
                    });
                });
                if (utxoOnly(this.chainType) && this.feeService) {
                    await this.feeService.monitorFees(false);
                }
                logger.info(`Monitoring stopped for ${this.monitoringId}`);
            } else {
                logger.info(`Monitoring will NOT stop. Process ${this.monitoringId} is not owner of current process ${monitoringState?.processOwner}`);
            }
        }
    }

    /**
     * Only one monitoring process can be alive at any time; this is taken care of by this method.
     */
    async waitAndAcquireMonitoringLock() {
        const randomMs = getRandomInt(0, RANDOM_SLEEP_MS_MAX);
        await sleepMs(randomMs);
        // try to acquire free lock
        const start = await this.acquireMonitoringLock();
        if (start.acquired) {
            logger.info(`Monitoring created for chain ${this.monitoringId}`);
            return true;
        }
        // lock is marked as locked, wait a bit to see if it is alive or should be taken over
        logger.info(`Monitoring possibly running for chain ${this.monitoringId} - waiting for liveness confirmation or expiration`);
        const startTime = Date.now();
        while (Date.now() - startTime < MONITOR_EXPIRATION_INTERVAL + 2 * MONITOR_PING_INTERVAL) {   // condition not really necessary - loop should always finish before this
            await sleepMs(MONITOR_PING_INTERVAL);
            // try to acquire lock again
            const next = await this.acquireMonitoringLock();
            // if the lock expired or was released in the meantime, it will be acquired now
            if (next.acquired) {
                logger.info(`Monitoring created for chain ${this.monitoringId} - old lock released or expired`);
                return true;
            }
            // if the lock ping tme increased, the thread holding it is apparently still active, so we give up and leave the old thread to do the work
            if (next.lastPing > start.lastPing) {
                logger.info(`Another monitoring instance is already running for chain ${this.monitoringId}`);
                return false;
            }
        }
        logger.warn(`Timeout waiting for monitoring lock for chain ${this.monitoringId}`);
        return false;
    }

    async acquireMonitoringLock() {
        return await retryDatabaseTransaction(`trying to obtain monitoring lock for chain ${this.monitoringId}`, async () => {
            return await transactional(this.rootEm, async em => {
                const monitoringState = await fetchMonitoringState(em, this.chainType);
                const now = Date.now();
                if (monitoringState == null) {
                    // no lock has been created for this chain yet - create new
                    em.create(MonitoringStateEntity,
                        {
                            chainType: this.chainType,
                            lastPingInTimestamp: toBN(now),
                            processOwner: this.monitoringId
                        } as RequiredEntityData<MonitoringStateEntity>,
                        { persist: true });
                    return { acquired: true } as const;
                } else {
                    const lastPing = monitoringState.lastPingInTimestamp.toNumber();
                    if (now > lastPing + MONITOR_EXPIRATION_INTERVAL) {
                        // old lock expired or released (marked by lastPing==0) - take over lock
                        monitoringState.lastPingInTimestamp = toBN(now);
                        monitoringState.processOwner = this.monitoringId;
                        return { acquired: true } as const;
                    } else {
                        // just return the lock state
                        return { acquired: false, lastPing } as const;
                    }
                }
            });
        });
    }

    private async updatePingLoop(): Promise<void> {
        while (this.monitoring) {
            await retryDatabaseTransaction(`updating ping status for chain ${this.monitoringId}`, async () => {
                await updateMonitoringState(this.rootEm, this.chainType, (monitoringEnt) => {
                    if (monitoringEnt.processOwner === this.monitoringId) {
                        monitoringEnt.lastPingInTimestamp = toBN(Date.now());
                    } else {
                        logger.info(`Monitoring thread was taken over from ${this.monitoringId} by ${monitoringEnt.processOwner}`);
                        this.monitoring = false;
                    }
                });
            }).catch((error) => {
                logger.error(`${error} - stopping monitor`);    // error will always be "Too many failed attepmts..."
                this.monitoring = false;
            });
            await sleepMs(MONITOR_PING_INTERVAL);
        }
    }

    private async monitoringMainLoop(wallet: IMonitoredWallet) {
        while (this.monitoring) {
            try {
                const networkUp = await wallet.checkNetworkStatus();
                if (!networkUp) {
                    logger.error(`Network is down ${this.monitoringId} - trying again in ${RESTART_IN_DUE_NO_RESPONSE}`);
                    await sleepMs(RESTART_IN_DUE_NO_RESPONSE);
                    continue;
                }
                await this.processTransactions([TransactionStatus.TX_PREPARED], wallet.submitPreparedTransactions.bind(wallet));
                if (wallet.resubmitSubmissionFailedTransactions) {
                    await this.processTransactions([TransactionStatus.TX_SUBMISSION_FAILED], wallet.resubmitSubmissionFailedTransactions.bind(wallet));
                }
                await this.processTransactions([TransactionStatus.TX_PENDING], wallet.checkPendingTransaction.bind(wallet));
                await this.processTransactions([TransactionStatus.TX_CREATED], wallet.prepareAndSubmitCreatedTransaction.bind(wallet));
                await this.processTransactions([TransactionStatus.TX_SUBMITTED, TransactionStatus.TX_REPLACED_PENDING], wallet.checkSubmittedTransaction.bind(wallet));
            } catch (error) {
                if (error instanceof StopTransactionMonitor) break;
                logger.error(`Monitoring ${this.monitoringId} run into error. Restarting in ${MONITOR_LOOP_SLEEP}: ${errorMessage(error)}`);
            }
            await sleepMs(MONITOR_LOOP_SLEEP);
        }
        logger.info(`Monitoring stopped for chain ${this.monitoringId}`);
    }

    async processTransactions(
        statuses: TransactionStatus[],
        processFunction: (txEnt: TransactionEntity) => Promise<void>
    ): Promise<void> {
        const transactionEntities = await fetchTransactionEntities(this.rootEm, this.chainType, statuses);
        for (const txEnt of transactionEntities) {
            this.checkIfMonitoringStopped();
            try {
                await processFunction(txEnt);
            } catch (error) /* istanbul ignore next */ {
                logger.error(`Cannot process transaction ${txEnt.id}: ${errorMessage(error)}`);
            }
        }
        this.checkIfMonitoringStopped();
    }

    private checkIfMonitoringStopped() {
        if (!this.monitoring) {
            logger.info(`Monitoring should be stopped for chain ${this.monitoringId}`);
            throw new StopTransactionMonitor();
        }
    }
}
