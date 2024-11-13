import { EntityManager, RequiredEntityData } from "@mikro-orm/core";
import { toBN } from "web3-utils";
import { countTransactionsWithStatuses, fetchMonitoringState, fetchTransactionEntities, retryDatabaseTransaction, transactional, updateMonitoringState } from "../../db/dbutils";
import { TransactionEntity, TransactionStatus } from "../../entity/transaction";
import { ChainType, MONITOR_EXPIRATION_INTERVAL, MONITOR_LOOP_SLEEP, MONITOR_PING_INTERVAL, RANDOM_SLEEP_MS_MAX, RESTART_IN_DUE_NO_RESPONSE } from "../../utils/constants";
import { logger } from "../../utils/logger";
import { convertToTimestamp, getCurrentTimestampInSeconds, getRandomInt, sleepMs, stuckTransactionConstants } from "../../utils/utils";
import { getConfirmedAfter, getDefaultBlockTimeInSeconds, utxoOnly } from "../utxo/UTXOUtils";
import { ServiceRepository } from "../../ServiceRepository";
import { BlockchainFeeService } from "../../fee-service/fee-service";
import { MonitoringStateEntity } from "../../entity/monitoringState";
import { errorMessage } from "../../utils/axios-utils";
import { UTXOBlockchainAPI } from "../../blockchain-apis/UTXOBlockchainAPI";

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
    private numberOfTransactionsPerBlock = 10; // For FAssets we have 10 transactions per block to complete
    monitoringId: string;
    feeService: BlockchainFeeService | undefined;
    executionBlockOffset: number;


    constructor(chainType: ChainType, rootEm: EntityManager, monitoringId: string) {
        this.chainType = chainType;
        this.rootEm = rootEm;
        this.monitoringId = monitoringId;
        if (utxoOnly(this.chainType)) {
            this.feeService = ServiceRepository.get(this.chainType, BlockchainFeeService);
        }
        this.executionBlockOffset = stuckTransactionConstants(this.chainType).executionBlockOffset!;
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
            Promise.allSettled
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
                await this.processTransactions([TransactionStatus.TX_PREPARED], wallet.submitPreparedTransactions);
                if (wallet.resubmitSubmissionFailedTransactions) {
                    await this.processTransactions([TransactionStatus.TX_SUBMISSION_FAILED], wallet.resubmitSubmissionFailedTransactions);
                }
                await this.processTransactions([TransactionStatus.TX_PENDING], wallet.checkPendingTransaction);
                await this.processTransactions([TransactionStatus.TX_CREATED], wallet.prepareAndSubmitCreatedTransaction);
                await this.processTransactions([TransactionStatus.TX_SUBMITTED, TransactionStatus.TX_REPLACED_PENDING], wallet.checkSubmittedTransaction);
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
        let transactionEntities = await fetchTransactionEntities(this.rootEm, this.chainType, statuses);

        // Filter out the transactions which can wait a bit to prevent locking of the wallet by consuming all UTXOs
        if (utxoOnly(this.chainType) && (statuses.includes(TransactionStatus.TX_CREATED))) {
            transactionEntities = this.sortTransactionEntities(transactionEntities);
            const currentBlockHeight = await ServiceRepository.get(this.chainType, UTXOBlockchainAPI).getCurrentBlockHeight();

            const blockBuffer = this.executionBlockOffset / 3;
            // Process only entities that have currentBlockHeight + (executionBlockOffset + blockBuffer) <= executeUntilBlock if there are more than X transactions
            const numOfPreparedAndSubmitted = await countTransactionsWithStatuses(this.rootEm, this.chainType, [TransactionStatus.TX_PREPARED, TransactionStatus.TX_SUBMITTED]);
            if (numOfPreparedAndSubmitted > this.numberOfTransactionsPerBlock * getConfirmedAfter(this.chainType) / 2) {
                transactionEntities = transactionEntities.filter(t => this.calculateTransactionPriority(t, this.chainType, currentBlockHeight) >= blockBuffer);
            }
        }

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
    private calculateTransactionPriority(entity: TransactionEntity, chainType: ChainType, currentBlockHeight: number): number {
        let blockPriority = 0;
        let timestampPriority = 0;

        if (entity.executeUntilBlock && entity.executeUntilTimestamp) {
            blockPriority = 1 / (entity.executeUntilBlock - currentBlockHeight - this.executionBlockOffset);
        }

        let executeUntilTimestamp = entity.executeUntilTimestamp;
        if (executeUntilTimestamp && executeUntilTimestamp.toString().length > 11) { // legacy: there used to be dates stored in db.
            executeUntilTimestamp = toBN(convertToTimestamp(executeUntilTimestamp.toString()));
        }

        if (executeUntilTimestamp) {
            const now = toBN(getCurrentTimestampInSeconds());
            const defaultBlockTimeInSeconds = getDefaultBlockTimeInSeconds(chainType);
            timestampPriority = 1 / (executeUntilTimestamp.sub(now).subn(this.executionBlockOffset * defaultBlockTimeInSeconds).divn(defaultBlockTimeInSeconds).toNumber());
        }

        return Math.max(blockPriority, timestampPriority);
    }

}
