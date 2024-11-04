import { EntityManager, RequiredEntityData } from "@mikro-orm/core";
import { toBN } from "web3-utils";
import {
    countTransactionsWithStatuses,
    fetchMonitoringState,
    fetchTransactionEntities,
    updateMonitoringState,
} from "../../db/dbutils";
import { MonitoringStateEntity } from "../../entity/monitoringState";
import { TransactionEntity, TransactionStatus } from "../../entity/transaction";
import {
    BUFFER_PING_INTERVAL,
    ChainType,
    PING_INTERVAL,
    RANDOM_SLEEP_MS_MAX,
    RESTART_IN_DUE_NO_RESPONSE,
    RESTART_IN_DUE_TO_ERROR,
} from "../../utils/constants";
import { logger } from "../../utils/logger";
import {
    convertToTimestamp,
    getCurrentTimestampInSeconds,
    getRandomInt,
    sleepMs,
    stuckTransactionConstants,
} from "../../utils/utils";
import { errorMessage } from "../../utils/axios-utils";
import { ServiceRepository } from "../../ServiceRepository";
import { BlockchainFeeService } from "../../fee-service/fee-service";
import {getConfirmedAfter, getDefaultBlockTimeInSeconds, utxoOnly} from "../utxo/UTXOUtils";
import { UTXOBlockchainAPI } from "../../blockchain-apis/UTXOBlockchainAPI";

export class TransactionMonitor {
    private monitoring = false;
    private chainType: ChainType;
    private rootEm: EntityManager;
    private numberOfTransactionsPerBlock = 10; // For FAssets we have 10 transactions per block to complete
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
                await updateMonitoringState(this.rootEm, this.chainType, (monitoringEnt) => {
                    monitoringEnt.lastPingInTimestamp = toBN(0);
                });
                if (utxoOnly(this.chainType)) {
                    const feeService = ServiceRepository.get(this.chainType, BlockchainFeeService);
                    await feeService.monitorFees(false);
                }
                logger.info(`Monitoring stopped for ${this.monitoringId}`);
            } else {
                logger.info(`Monitoring will NOT stop. Process ${this.monitoringId} is not owner of current process ${monitoringState?.processOwner}`);
            }
        }
    }

    async startMonitoringTransactionProgress(
        submitPreparedTransactions: (txEnt: TransactionEntity) => Promise<void>,
        checkPendingTransactions: (txEnt: TransactionEntity) => Promise<void>,
        prepareAndSubmitCreatedTransactions: (txEnt: TransactionEntity) => Promise<void>,
        checkSubmittedTransactions: (txEnt: TransactionEntity) => Promise<void>,
        checkNetworkStatus: () => Promise<boolean>,
        resubmitSubmissionFailedTransactions?: (txEnt: TransactionEntity) => Promise<void>,
        executionBlockOffset?: number
    ): Promise<void> {
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
                    const updatedMonitoringState = await fetchMonitoringState(this.rootEm, this.monitoringId);
                    const newNow = (new Date()).getTime();
                    if (updatedMonitoringState && (newNow - updatedMonitoringState.lastPingInTimestamp.toNumber()) < BUFFER_PING_INTERVAL) {
                        logger.info(`Another monitoring instance is already running for chain ${this.monitoringId} (double check)`);
                        return;
                    }
                }
            }
            const lastPingInTimestamp = toBN((new Date()).getTime());
            await updateMonitoringState(this.rootEm, this.chainType, (monitoringEnt) => {
                monitoringEnt.lastPingInTimestamp = lastPingInTimestamp;
                monitoringEnt.processOwner = this.monitoringId;
            });

            this.monitoring = true;
            logger.info(`Monitoring started for chain ${this.monitoringId}`);

            void this.updatePing();

            if (utxoOnly(this.chainType)) {
                const feeService = ServiceRepository.get(this.chainType, BlockchainFeeService);
                await feeService.setupHistory();
                void feeService.monitorFees(this.monitoring);
            }

            if (!executionBlockOffset) {
                executionBlockOffset = stuckTransactionConstants(this.chainType).executionBlockOffset!;
            }

            while (this.monitoring) {
                try {
                    const networkUp = await checkNetworkStatus();
                    if (!networkUp) {
                        logger.error(`Network is down ${this.monitoringId} - trying again in ${RESTART_IN_DUE_NO_RESPONSE}`);
                        await sleepMs(RESTART_IN_DUE_NO_RESPONSE);
                        continue;
                    }
                    await this.processTransactions(this.rootEm, this.chainType, [TransactionStatus.TX_PREPARED], submitPreparedTransactions, executionBlockOffset);
                    /* istanbul ignore next */
                    if (this.shouldStopMonitoring()) break;
                    if (resubmitSubmissionFailedTransactions) {
                        await this.processTransactions(this.rootEm, this.chainType, [TransactionStatus.TX_SUBMISSION_FAILED], resubmitSubmissionFailedTransactions, executionBlockOffset);
                        /* istanbul ignore next */
                        if (this.shouldStopMonitoring()) break;
                    }
                    await this.processTransactions(this.rootEm, this.chainType, [TransactionStatus.TX_PENDING], checkPendingTransactions, executionBlockOffset);
                    /* istanbul ignore next */
                    if (this.shouldStopMonitoring()) break;
                    await this.processTransactions(this.rootEm, this.chainType, [TransactionStatus.TX_CREATED], prepareAndSubmitCreatedTransactions, executionBlockOffset);
                    /* istanbul ignore next */
                    if (this.shouldStopMonitoring()) break;
                    await this.processTransactions(this.rootEm, this.chainType, [TransactionStatus.TX_SUBMITTED, TransactionStatus.TX_REPLACED_PENDING], checkSubmittedTransactions, executionBlockOffset);
                     /* istanbul ignore next */
                    if (this.shouldStopMonitoring()) break;
                } /* istanbul ignore next */ catch (error) {
                    logger.error(`Monitoring ${this.monitoringId} run into error. Restarting in ${RESTART_IN_DUE_TO_ERROR}: ${errorMessage(error)}`);
                }
                await sleepMs(RESTART_IN_DUE_TO_ERROR);
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

    private async processTransactions(
        rootEm: EntityManager,
        chainType: ChainType,
        statuses: TransactionStatus[],
        processFunction: (txEnt: TransactionEntity) => Promise<void>,
        executionBlockOffset: number
    ): Promise<void> {
        let transactionEntities = await fetchTransactionEntities(rootEm, chainType, statuses);

        // Filter out the transactions which can wait a bit to prevent locking of the wallet by consuming all UTXOs
        if (utxoOnly(chainType) && (statuses.includes(TransactionStatus.TX_CREATED))) {
            transactionEntities = this.sortTransactionEntities(transactionEntities);
            const currentBlockHeight = await ServiceRepository.get(chainType, UTXOBlockchainAPI).getCurrentBlockHeight();

            const blockBuffer = executionBlockOffset / 3;
            // Process only entities that have currentBlockHeight + (executionBlockOffset + blockBuffer) <= executeUntilBlock if there are more than X transactions
            if ((await countTransactionsWithStatuses(rootEm, chainType, [TransactionStatus.TX_PREPARED, TransactionStatus.TX_SUBMITTED])) > this.numberOfTransactionsPerBlock * getConfirmedAfter(this.chainType) / 2) {
                transactionEntities = transactionEntities.filter(t => this.calculateTransactionPriority(t, chainType, currentBlockHeight, executionBlockOffset) >= blockBuffer);
            }
        }

        for (const txEnt of transactionEntities) {
            try {
                await processFunction(txEnt);
            } catch (e) /* istanbul ignore next */ {
                logger.error(`Cannot process transaction ${txEnt.id}`, e);
            }
        }
    }

    private sortTransactionEntities(entities: TransactionEntity[]): TransactionEntity[] {
        return entities.sort((a, b) => {
            if (a.executeUntilBlock && b.executeUntilBlock) {
                const blockComparison = a.executeUntilBlock - b.executeUntilBlock;
                if (blockComparison !== 0) {
                    return blockComparison;
                }
            }

            if (a.executeUntilTimestamp && b.executeUntilTimestamp) {
                return a.executeUntilTimestamp.sub(b.executeUntilTimestamp).toNumber();
            }

            return a.id - b.id;
        });
    }

    /**
     * @returns 1 / n where n is number of blocks before executeUntilBlock - executionBlockOffset (if neither are provided it returns 0)
     */
    private calculateTransactionPriority(entity: TransactionEntity, chainType: ChainType, currentBlockHeight: number, executionBlockOffset: number): number {
        let blockPriority = 0;
        let timestampPriority = 0;

        if (entity.executeUntilBlock && entity.executeUntilTimestamp) {
            blockPriority = 1 / (entity.executeUntilBlock - currentBlockHeight - executionBlockOffset);
        }

        let executeUntilTimestamp = entity.executeUntilTimestamp;
        if (executeUntilTimestamp && executeUntilTimestamp.toString().length > 11) { // legacy: there used to be dates stored in db.
            executeUntilTimestamp = toBN(convertToTimestamp(executeUntilTimestamp.toString()));
        }

        if (executeUntilTimestamp) {
            const now = toBN(getCurrentTimestampInSeconds());
            const defaultBlockTimeInSeconds = getDefaultBlockTimeInSeconds(chainType);
            timestampPriority = 1 / (executeUntilTimestamp.sub(now).subn(executionBlockOffset * defaultBlockTimeInSeconds).divn(defaultBlockTimeInSeconds).toNumber());
        }

        return Math.max(blockPriority, timestampPriority);
    }
}