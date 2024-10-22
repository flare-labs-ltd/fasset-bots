import { EntityManager, RequiredEntityData } from "@mikro-orm/core";
import { toBN } from "web3-utils";
import { fetchMonitoringState, updateMonitoringState, processTransactions } from "../../db/dbutils";
import { MonitoringStateEntity } from "../../entity/monitoringState";
import { TransactionEntity, TransactionStatus } from "../../entity/transaction";
import { ChainType, BUFFER_PING_INTERVAL, PING_INTERVAL } from "../../utils/constants";
import { logger } from "../../utils/logger";
import { getRandomInt, sleepMs } from "../../utils/utils";
import { errorMessage } from "../../utils/axios-utils";
import { ServiceRepository } from "../../ServiceRepository";
import { BlockchainFeeService } from "../../fee-service/fee-service";
import { utxoOnly } from "../utxo/UTXOUtils";

export class TransactionMonitor {
    private monitoring = false;
    private chainType: ChainType;
    private rootEm: EntityManager;
    monitoringId: string;

    constructor(chainType: ChainType, rootEm: EntityManager, monitoringId: string) {
        this.chainType = chainType;
        this.rootEm = rootEm;
        this.monitoringId = monitoringId;
    }

    restartInDueToError = 2000; //2s
    restartInDueNoResponse = 20000; //20s

    async isMonitoring(): Promise<boolean> {
        const monitoringState = await fetchMonitoringState(this.rootEm, this.chainType);
        if (!monitoringState) {
            console.warn(`Is monitoring? ${this.monitoringId} - false`)
            return false;
        }
        const now = (new Date()).getTime();
        const elapsed = now - monitoringState.lastPingInTimestamp.toNumber();
        console.warn(`Is monitoring? ${this.monitoringId} - ${elapsed < BUFFER_PING_INTERVAL}`, elapsed, BUFFER_PING_INTERVAL)
        return elapsed < BUFFER_PING_INTERVAL;
    }

    async stopMonitoring(): Promise<void> {
        logger.info(`Monitoring will stop for ${this.monitoringId} ...`);
        await updateMonitoringState(this.rootEm, this.chainType, (monitoringEnt) => {
            monitoringEnt.lastPingInTimestamp = toBN(0);
        });
        this.monitoring = false;
        if (utxoOnly(this.chainType)) {
            const feeService = ServiceRepository.get(this.chainType, BlockchainFeeService);
            await feeService.monitorFees(false);
        }
        logger.info(`Monitoring stooped for ${this.monitoringId}`);
        console.info(`Monitoring stooped for ${this.monitoringId}`);
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
            console.warn(`BEGIN: ${monitoringState?.lastPingInTimestamp.toString()}, ${this.monitoringId}`)
            if (!monitoringState) {
                const createdAt = toBN((new Date()).getTime());
                logger.info(`Monitoring created for chain ${this.monitoringId}`);
                console.warn(`Monitoring created for chain ${this.monitoringId} at ${createdAt.toString()}`);
                this.rootEm.create(MonitoringStateEntity, {
                    chainType: this.chainType,
                    lastPingInTimestamp: createdAt,
                } as RequiredEntityData<MonitoringStateEntity>);
                await this.rootEm.flush();
            } else if (monitoringState.lastPingInTimestamp) {
                logger.info(`Monitoring possibly running for chain ${this.monitoringId}`);
                console.warn(`Monitoring possibly running for chain ${this.monitoringId} at ${monitoringState.lastPingInTimestamp.toString()}`);
                const reFetchedMonitoringState = await fetchMonitoringState(this.rootEm, this.chainType);
                const now = (new Date()).getTime();
                if (reFetchedMonitoringState && ((now - reFetchedMonitoringState.lastPingInTimestamp.toNumber()) < BUFFER_PING_INTERVAL)) {
                    logger.info(`Monitoring checking if already running for chain ${this.monitoringId} ...`);
                    console.warn(`Monitoring checking if already running for chain ${this.monitoringId} ... at ${now}`);
                    await sleepMs(BUFFER_PING_INTERVAL + randomMs);
                    const updatedMonitoringState = await fetchMonitoringState(this.rootEm, this.monitoringId);
                    const newNow = (new Date()).getTime();
                    if (updatedMonitoringState && (newNow - updatedMonitoringState.lastPingInTimestamp.toNumber()) < BUFFER_PING_INTERVAL) {
                        logger.info(`Another monitoring instance is already running for chain ${this.monitoringId}`);
                        console.warn(`Another monitoring instance is already running for chain ${this.monitoringId} at ${newNow.toString()}`);
                        return;
                    }
                }
            }
            const lastPingInTimestamp = toBN((new Date()).getTime());
            await updateMonitoringState(this.rootEm, this.chainType, (monitoringEnt) => {
                monitoringEnt.lastPingInTimestamp = lastPingInTimestamp;
            });

            this.monitoring = true;
            logger.info(`Monitoring started for chain ${this.monitoringId}`);
            console.warn(`Monitoring started for chain ${this.monitoringId} at ${lastPingInTimestamp.toString()}`);
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
                        logger.error(`Network is down ${this.monitoringId} - trying again in ${this.restartInDueNoResponse}`);
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
                    logger.error(`Monitoring ${this.monitoringId} run into error. Restarting in ${this.restartInDueToError}: ${errorMessage(error)}`);
                }
                await sleepMs(this.restartInDueToError);
            }

            logger.info(`Monitoring stopped for chain ${this.monitoringId}`);
        } /* istanbul ignore next */ catch (error) {
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
                await updateMonitoringState(this.rootEm, this.chainType, (monitoringEnt) => {
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