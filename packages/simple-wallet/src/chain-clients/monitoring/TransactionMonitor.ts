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
        const randomMs = getRandomInt(0, RANDOM_SLEEP_MS_MAX);
        await sleepMs(randomMs);

        try {
            const monitoringState = await fetchMonitoringState(this.rootEm, this.chainType);
            if (!monitoringState) {
                const createdAt = toBN((new Date()).getTime());
                logger.info(`Monitoring created for chain ${this.monitoringId}`);
                this.rootEm.create(MonitoringStateEntity, {
                    chainType: this.chainType,
                    lastPingInTimestamp: createdAt,
                    processOwner: this.monitoringId
                } as RequiredEntityData<MonitoringStateEntity>);
                await this.rootEm.flush();
            } else if (await this.isMonitoring()) {
                logger.info(`Another monitoring instance is already running for chain ${this.monitoringId}`);
                return;
            } else if (monitoringState.lastPingInTimestamp) {
                logger.info(`Monitoring possibly running for chain ${this.monitoringId}`);
                const reFetchedMonitoringState = await fetchMonitoringState(this.rootEm, this.chainType);
                const now = (new Date()).getTime();
                if (reFetchedMonitoringState && ((now - reFetchedMonitoringState.lastPingInTimestamp.toNumber()) < BUFFER_PING_INTERVAL)) {
                    logger.info(`Monitoring checking if already running for chain ${this.monitoringId} ...`);
                    await sleepMs(BUFFER_PING_INTERVAL + randomMs);
                    const updatedMonitoringState = await fetchMonitoringState(this.rootEm, this.chainType);
                    const newNow = (new Date()).getTime();
                    if (updatedMonitoringState && (newNow - updatedMonitoringState.lastPingInTimestamp.toNumber()) < BUFFER_PING_INTERVAL) {
                        logger.info(`Another monitoring instance is already running for chain ${this.monitoringId} (double check)`);
                        return;
                    }
                }
            }
            const lastPingInTimestamp = toBN((new Date()).getTime());
            await updateMonitoringState(this.rootEm, this.chainType, async (monitoringEnt) => {
                monitoringEnt.lastPingInTimestamp = lastPingInTimestamp;
                monitoringEnt.processOwner = this.monitoringId;
            });

            this.monitoring = true;
            logger.info(`Monitoring started for chain ${this.monitoringId}`);

            void this.updatePing();

            while (this.monitoring) {
                try {
                    const networkUp = await wallet.checkNetworkStatus();
                    if (!networkUp) {
                        logger.error(`Network is down ${this.monitoringId} - trying again in ${RESTART_IN_DUE_NO_RESPONSE}`);
                        await sleepMs(RESTART_IN_DUE_NO_RESPONSE);
                        continue;
                    }
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

    private async updatePing(): Promise<void> {
        while (this.monitoring) {
            try {
                await updateMonitoringState(this.rootEm, this.chainType, async (monitoringEnt) => {
                    monitoringEnt.lastPingInTimestamp = toBN((new Date()).getTime());
                });
                await sleepMs(PING_INTERVAL);
            } catch (error) {
                logger.error(`Error updating ping status for chain ${this.monitoringId}`, error);
                this.monitoring = false;
            }
        }
    }
}
