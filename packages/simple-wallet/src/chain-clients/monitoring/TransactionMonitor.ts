import { EntityManager, RequiredEntityData } from "@mikro-orm/core";
import { toBN } from "web3-utils";
import { fetchMonitoringState, updateMonitoringState, processTransactions } from "../../db/dbutils";
import { MonitoringStateEntity } from "../../entity/monitoring_state";
import { TransactionEntity, TransactionStatus } from "../../entity/transaction";
import { ChainType, BUFFER_PING_INTERVAL, PING_INTERVAL, RANDOM_SLEEP_MS_MAX, RESTART_IN_DUE_NO_RESPONSE, RESTART_IN_DUE_TO_ERROR } from "../../utils/constants";
import { logger } from "../../utils/logger";
import { getRandomInt, sleepMs } from "../../utils/utils";
import { errorMessage } from "../../utils/axios-error-utils";

export interface IMonitoredWallet {
    submitPreparedTransactions(txEnt: TransactionEntity): Promise<void>;
    checkPendingTransaction(txEnt: TransactionEntity): Promise<void>;
    prepareAndSubmitCreatedTransaction(txEnt: TransactionEntity): Promise<void>;
    checkSubmittedTransaction(txEnt: TransactionEntity): Promise<void>;
    checkNetworkStatus(): Promise<boolean>;
    resubmitSubmissionFailedTransactions?(txEnt: TransactionEntity): Promise<void>;
}

export class TransactionMonitor {
    private monitoring: boolean = false;
    private chainType: ChainType;
    private rootEm: EntityManager;
    monitoringId: string;

    constructor(chainType: ChainType, rootEm: EntityManager, monitoringId: string) {
        this.chainType = chainType;
        this.rootEm = rootEm;
        this.monitoringId = monitoringId;
    }

    async isMonitoring(): Promise<boolean> {
        const monitoringState = await fetchMonitoringState(this.rootEm, this.chainType);
        if (!monitoringState) {
            return false;
        }
        const now = (new Date()).getTime();
        const elapsed = now - monitoringState.lastPingInTimestamp.toNumber();
        return elapsed < BUFFER_PING_INTERVAL;
    }

    async stopMonitoring(): Promise<void> {
        if (this.monitoring) {
            logger.info(`Monitoring will stop for ${this.monitoringId} ...`);
            const monitoringState = await fetchMonitoringState(this.rootEm, this.chainType);
            if (monitoringState?.processOwner && monitoringState.processOwner === this.monitoringId) {
                this.monitoring = false;
                console.log(`Stopping wallet monitoring ${this.monitoringId} ...`);
                const randomMs = getRandomInt(0, RANDOM_SLEEP_MS_MAX);
                await sleepMs(PING_INTERVAL + randomMs); // to make sure pinger stops
                await updateMonitoringState(this.rootEm, this.chainType, async (monitoringEnt) => {
                    monitoringEnt.lastPingInTimestamp = toBN(0);
                });
                this.monitoring = false;
                logger.info(`Monitoring stopped for ${this.monitoringId}`);
            } else {
                logger.info(`Monitoring will NOT stop. Process ${this.monitoringId} is not owner of current process ${monitoringState?.processOwner}`);
            }
        }
    }

    async startMonitoringTransactionProgress(wallet: IMonitoredWallet): Promise<void> {
        const acquiredLock = await this.waitAndAcquireMonitoringLock();
        if (!acquiredLock) return;
        // mark started
        this.monitoring = true;
        logger.info(`Monitoring started for chain ${this.monitoringId}`);
        // start pinger in the background
        void this.updatePingLoop();
        // start main loop
        await this.monitoringMainLoop(wallet);
    }

    async acquireMonitoringLock() {
        const R = 3;
        for (let i = 1; i <= R; i++) {
            try {
                return await this.rootEm.transactional(async em => {
                    const monitoringState = await fetchMonitoringState(em, this.chainType);
                    const now = new Date().getTime();
                    if (monitoringState == null) {
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
                        if (now > lastPing + BUFFER_PING_INTERVAL) {
                            // old lock expired or released - take over
                            monitoringState.lastPingInTimestamp = toBN(now);
                            monitoringState.processOwner = this.monitoringId;
                            return { acquired: true } as const;
                        } else {
                            return { acquired: false, lastPing } as const;
                        }
                    }
                });
            } catch (error) {
                const nextAction = i <= R ? `retrying (${i})` : `failed`;
                logger.error(`Error trying to obtain monitoring lock - ${nextAction}: ${error}`);
            }
        }
        throw new Error("Too many failed attempts for redemption");
    }

    async waitAndAcquireMonitoringLock() {
        const randomMs = getRandomInt(0, RANDOM_SLEEP_MS_MAX);
        await sleepMs(randomMs);
        //
        const start = await this.acquireMonitoringLock();
        if (start.acquired) {
            logger.info(`Monitoring created for chain ${this.monitoringId}`);
            return true;
        }
        logger.info(`Monitoring possibly running for chain ${this.monitoringId} - waiting for liveness confirmation or expiration`);
        const startTime = new Date().getTime();
        while (new Date().getTime() - startTime < BUFFER_PING_INTERVAL + 2 * PING_INTERVAL) {   // should always finish before this
            await sleepMs(PING_INTERVAL);
            const next = await this.acquireMonitoringLock();
            if (next.acquired) {
                logger.info(`Monitoring created for chain ${this.monitoringId} - old lock released or expired`);
                return true;
            }
            if (next.lastPing > start.lastPing) { // the current thread is apparently still active
                logger.info(`Another monitoring instance is already running for chain ${this.monitoringId}`);
                return false;
            }
        }
        logger.info(`Timeout waiting for monitoring lock for chain ${this.monitoringId}`);
        return false;
    }

    async monitoringMainLoop(wallet: IMonitoredWallet) {
        try {
            while (this.monitoring) {
                try {
                    const networkUp = await wallet.checkNetworkStatus();
                    if (!networkUp) {
                        logger.error(`Network is down ${this.monitoringId} - trying again in ${RESTART_IN_DUE_NO_RESPONSE}`);
                        await sleepMs(RESTART_IN_DUE_NO_RESPONSE);
                        continue;
                    }
                    if (this.shouldStopMonitoring()) break;
                    await processTransactions(this.rootEm, this.chainType, TransactionStatus.TX_PREPARED, wallet.submitPreparedTransactions);
                    /* istanbul ignore next */
                    if (this.shouldStopMonitoring()) break;
                    if (wallet.resubmitSubmissionFailedTransactions) {
                        await processTransactions(this.rootEm, this.chainType, TransactionStatus.TX_SUBMISSION_FAILED, wallet.resubmitSubmissionFailedTransactions);
                        /* istanbul ignore next */
                        if (this.shouldStopMonitoring()) break;
                    }
                    await processTransactions(this.rootEm, this.chainType, TransactionStatus.TX_PENDING, wallet.checkPendingTransaction);
                    /* istanbul ignore next */
                    if (this.shouldStopMonitoring()) break;
                    await processTransactions(this.rootEm, this.chainType, TransactionStatus.TX_CREATED, wallet.prepareAndSubmitCreatedTransaction);
                    /* istanbul ignore next */
                    if (this.shouldStopMonitoring()) break;
                    await processTransactions(this.rootEm, this.chainType, TransactionStatus.TX_SUBMITTED, wallet.checkSubmittedTransaction);
                    /* istanbul ignore next */
                    if (this.shouldStopMonitoring()) break;

                } /* istanbul ignore next */ catch (error) {
                    logger.error(`Monitoring ${this.monitoringId} run into error. Restarting in ${RESTART_IN_DUE_TO_ERROR}: ${errorMessage(error)}`);
                }
                await sleepMs(RESTART_IN_DUE_TO_ERROR);
            }
            logger.info(`Monitoring stopped for chain ${this.monitoringId}`);
        } catch (error) {
            logger.error(`Monitoring failed for chain ${this.monitoringId} error: ${errorMessage(error)}.`);
        }
    }

    private shouldStopMonitoring(): boolean {
        if (!this.monitoring) {
            logger.info(`Monitoring should be stopped for chain ${this.monitoringId}`);
            return true;
        }
        return false;
    }

    private async updatePingLoop(): Promise<void> {
        while (this.monitoring) {
            try {
                await updateMonitoringState(this.rootEm, this.chainType, async (monitoringEnt) => {
                    if (monitoringEnt.processOwner === this.monitoringId) {
                        monitoringEnt.lastPingInTimestamp = toBN(new Date().getTime());
                    } else {
                        logger.info(`Monitoring thread was taken over from ${this.monitoringId} by ${monitoringEnt.processOwner}`);
                        this.monitoring = false;
                    }
                });
                await sleepMs(PING_INTERVAL);
            } catch (error) {
                logger.error(`Error updating ping status for chain ${this.monitoringId}`, error);
                this.monitoring = false;
            }
        }
    }
}
