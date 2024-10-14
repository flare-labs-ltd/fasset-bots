import { EntityManager, RequiredEntityData } from "@mikro-orm/core";
import { toBN } from "web3-utils";
import { fetchMonitoringState, updateMonitoringState, processTransactions } from "../../db/dbutils";
import { MonitoringStateEntity } from "../../entity/monitoringState";
import { TransactionEntity, TransactionStatus } from "../../entity/transaction";
import { ChainType, BUFFER_PING_INTERVAL, PING_INTERVAL } from "../../utils/constants";
import { logger } from "../../utils/logger";
import { getRandomInt, sleepMs } from "../../utils/utils";
import { errorMessage } from "../../utils/axios-error-utils";
import { ServiceRepository } from "../../ServiceRepository";
import { BlockchainFeeService } from "../../fee-service/fee-service";
import { utxoOnly } from "../utxo/UTXOUtils";

export class TransactionMonitor {
    private monitoring = false;
    private chainType: ChainType;
    private rootEm: EntityManager;

    constructor(chainType: ChainType, rootEm: EntityManager) {
        this.chainType = chainType;
        this.rootEm = rootEm;
    }

    restartInDueToError = 2000; //2s
    restartInDueNoResponse = 20000; //20s

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
        await updateMonitoringState(this.rootEm, this.chainType, (monitoringEnt) => {
            monitoringEnt.lastPingInTimestamp = toBN(0);
        });
        this.monitoring = false;
        if (utxoOnly(this.chainType)) {
            const feeService = ServiceRepository.get(this.chainType, BlockchainFeeService);
            await feeService.monitorFees(false);
        }
    }

    async startMonitoringTransactionProgress(
        submitPreparedTransactions: (txEnt: TransactionEntity) => Promise<void>,
        checkPendingTransaction: (txEnt: TransactionEntity) => Promise<void>,
        prepareAndSubmitCreatedTransaction: (txEnt: TransactionEntity) => Promise<void>,
        checkSubmittedTransaction: (txEnt: TransactionEntity) => Promise<void>,
        checkNetworkStatus: () => Promise<boolean>,
        resubmitSubmissionFailedTransactions?: (txEnt: TransactionEntity) => Promise<void>
    ): Promise<void> {
        const randomMs = getRandomInt(0, 500);
        await sleepMs(randomMs);

        try {
            const monitoringState = await fetchMonitoringState(this.rootEm, this.chainType);
            if (!monitoringState) {
                logger.info(`Monitoring created for chain ${this.chainType}`);
                this.rootEm.create(MonitoringStateEntity, {
                    chainType: this.chainType,
                    lastPingInTimestamp: toBN((new Date()).getTime()),
                } as RequiredEntityData<MonitoringStateEntity>);
                await this.rootEm.flush();
            } else if (monitoringState.lastPingInTimestamp) {
                logger.info(`Monitoring possibly running for chain ${this.chainType}`);
                const reFetchedMonitoringState = await fetchMonitoringState(this.rootEm, this.chainType);
                const now = (new Date()).getTime();
                if (reFetchedMonitoringState && ((now - reFetchedMonitoringState.lastPingInTimestamp.toNumber()) < BUFFER_PING_INTERVAL)) {
                    logger.info(`Monitoring checking if already running for chain ${this.chainType} ...`);
                    await sleepMs(BUFFER_PING_INTERVAL + randomMs);
                    const updatedMonitoringState = await fetchMonitoringState(this.rootEm, this.chainType);
                    const newNow = (new Date()).getTime();
                    if (updatedMonitoringState && (newNow - updatedMonitoringState.lastPingInTimestamp.toNumber()) < BUFFER_PING_INTERVAL) {
                        logger.info(`Another monitoring instance is already running for chain ${this.chainType}`);
                        return;
                    }
                }
            }

            await updateMonitoringState(this.rootEm, this.chainType, (monitoringEnt) => {
                monitoringEnt.lastPingInTimestamp = toBN((new Date()).getTime());
            });

            this.monitoring = true;
            logger.info(`Monitoring started for chain ${this.chainType}`);

            if (utxoOnly(this.chainType)) {
                const feeService = ServiceRepository.get(this.chainType, BlockchainFeeService);
                await feeService.setupHistory();
                void feeService.monitorFees(this.monitoring);
            }

            void this.updatePing();

            while (this.monitoring) {
                try {
                    const networkUp = await checkNetworkStatus();
                    if (!networkUp) {
                        logger.error(`Network is down - trying again in ${this.restartInDueNoResponse}`);
                        await sleepMs(this.restartInDueNoResponse);
                        continue;
                    }
                    await processTransactions(this.rootEm, this.chainType, TransactionStatus.TX_PREPARED, submitPreparedTransactions);
                    /* istanbul ignore next */
                    if (this.shouldStopMonitoring()) break;
                    if (resubmitSubmissionFailedTransactions) {
                        await processTransactions(this.rootEm, this.chainType, TransactionStatus.TX_SUBMISSION_FAILED, resubmitSubmissionFailedTransactions);
                        /* istanbul ignore next */
                        if (this.shouldStopMonitoring()) break;
                    }
                    await processTransactions(this.rootEm, this.chainType, TransactionStatus.TX_PENDING, checkPendingTransaction);
                     /* istanbul ignore next */
                    if (this.shouldStopMonitoring()) break;
                    await processTransactions(this.rootEm, this.chainType, TransactionStatus.TX_CREATED, prepareAndSubmitCreatedTransaction);
                     /* istanbul ignore next */
                    if (this.shouldStopMonitoring()) break;
                    await processTransactions(this.rootEm, this.chainType, TransactionStatus.TX_SUBMITTED, checkSubmittedTransaction);
                     /* istanbul ignore next */
                    if (this.shouldStopMonitoring()) break;

                } /* istanbul ignore next */ catch (error) {
                    logger.error(`Monitoring run into error. Restarting in ${this.restartInDueToError}: ${errorMessage(error)}`);
                }
                await sleepMs(this.restartInDueToError);
            }

            logger.info(`Monitoring stopped for chain ${this.chainType}`);
        } /* istanbul ignore next */ catch (error) {
            logger.error(`Monitoring failed for chain ${this.chainType} error: ${errorMessage(error)}.`);
        }
    }

    private shouldStopMonitoring(): boolean {
        if (!this.monitoring) {
            logger.info(`Monitoring should be stopped for chain ${this.chainType}`);
            return true;
        }
        return false;
    }

    private async updatePing(): Promise<void> {
        while (this.monitoring) {
            try {
                await updateMonitoringState(this.rootEm, this.chainType, (monitoringEnt) => {
                    monitoringEnt.lastPingInTimestamp = toBN((new Date()).getTime());
                });
                await sleepMs(PING_INTERVAL);
            } catch (error) {
                logger.error(`Error updating ping status for chain ${this.chainType}`, error);
                this.monitoring = false;
            }
        }
    }
}