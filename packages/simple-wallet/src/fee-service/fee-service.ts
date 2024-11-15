import { ChainType } from "../utils/constants";
import { sleepMs } from "../utils/utils";
import { BlockStats } from "../interfaces/IWalletTransaction";
import { toBN } from "../utils/bnutils";
import BN from "bn.js";
import { logger } from "../utils/logger";

import { errorMessage, withRetry } from "../utils/axios-utils";
import { UTXOBlockchainAPI } from "../blockchain-apis/UTXOBlockchainAPI";
import { getDefaultFeePerKB } from "../chain-clients/utxo/UTXOUtils";

export class BlockchainFeeService {
    blockchainAPI: UTXOBlockchainAPI;
    history: BlockStats[] = [];
    numberOfBlocksInHistory = 11;
    sleepTimeMs = 5000;
    chainType: ChainType;
    useNBlocksToCalculateFee = 5;
    monitoringId: string;

    constructor(blockchainAPI: UTXOBlockchainAPI, chainType: ChainType, monitoringId: string) {
        this.chainType = chainType;
        this.blockchainAPI = blockchainAPI;
        this.monitoringId = monitoringId;
    }

    getLatestFeeStats(): BN {
        if (this.history.length < this.useNBlocksToCalculateFee) {
            return toBN(0);
        }
        const recentHistory = this.history.slice(- this.useNBlocksToCalculateFee);
        let weightedFeeSum = toBN(0);
        let totalWeight = 0;
        recentHistory.forEach((block, index) => {
            const weight = index + 1;
            weightedFeeSum = weightedFeeSum.add(block.averageFeePerKB.muln(weight));
            totalWeight += weight;
        });
        const movingAverageWeightedFee = weightedFeeSum.divn(totalWeight);
        return movingAverageWeightedFee;
    }

    getLatestMedianTime(): BN | null {
        /* istanbul ignore if */
        if (this.history.length < this.numberOfBlocksInHistory || !this.checkConsecutiveBlocks()) {
            return null;
        }
        const blockTimes = this.history.map(block => block.blockTime);
        blockTimes.sort((a, b) => a.sub(b).toNumber());
        const latestMedianTime = blockTimes[Math.floor(blockTimes.length / 2)];
        return latestMedianTime;
    }

    async monitorFees(monitoring: () => boolean): Promise<void> {
        logger.info(`${this.monitoringId}: Started monitoring fees.`);
        while (monitoring()) {
            const currentBlockHeight = await this.getCurrentBlockHeightWithRetry();
            /* istanbul ignore next */
            const lastStoredBlockHeight = this.history[this.history.length - 1]?.blockHeight;
            if (!currentBlockHeight || currentBlockHeight <= lastStoredBlockHeight) {
                await sleepMs(this.sleepTimeMs);
                continue;
            }

            let blockHeightToFetch = lastStoredBlockHeight + 1;
            while (blockHeightToFetch <= currentBlockHeight) {
                const feeStats = await this.getFeeStatsFromIndexer(blockHeightToFetch);
                /* istanbul ignore else */
                if (feeStats) {
                    /* istanbul ignore else */
                    if (this.history.length >= this.numberOfBlocksInHistory) {
                        this.history.shift(); // remove oldest block
                    }
                    this.history.push({
                        blockHeight: blockHeightToFetch,
                        averageFeePerKB: feeStats.averageFeePerKB,
                        blockTime: feeStats.blockTime,
                    });
                } else {
                    logger.error(`Missing block ${blockHeightToFetch}`);
                }
                blockHeightToFetch++;
            }
            await sleepMs(this.sleepTimeMs);
        }
        logger.info(`${this.monitoringId}: Stopped monitoring fees.`)
    }

    async setupHistory(): Promise<void> {
        if (this.history.length === this.numberOfBlocksInHistory) {
            return;
        }
        logger.info(`${this.monitoringId}: Setup history started.`)
        const currentBlockHeight = await this.getCurrentBlockHeightWithRetry();
        /* istanbul ignore next */
        if (currentBlockHeight === 0) {
            return;
        }
        let blockHeightToFetch = currentBlockHeight;
        while (this.history.length < this.numberOfBlocksInHistory) {
            const feeStats = await this.getFeeStatsFromIndexer(blockHeightToFetch);
            /* istanbul ignore else */
            if (feeStats) {
                this.history.unshift({
                    blockHeight: blockHeightToFetch,
                    averageFeePerKB: feeStats.averageFeePerKB,
                    blockTime: feeStats.blockTime,
                });
                blockHeightToFetch--;
            } else {
                logger.error(`Failed to retrieve fee stats for block ${blockHeightToFetch} during history setup.`);
            }
        }
        logger.info(`${this.monitoringId}: Setup history completed.`)
    }

    async getCurrentBlockHeight() {
        try {
            const blockHeight = await this.blockchainAPI.getCurrentBlockHeight()
            return blockHeight;
        } catch (error) /* istanbul ignore next */ {
            logger.error(`Fee service failed to fetch block height ${errorMessage(error)}`);
            return 0;
        }
    }

    async getCurrentBlockHeightWithRetry(retryLimit = 3): Promise<number> {
        return await withRetry(
            () => this.getCurrentBlockHeight(),
            retryLimit,
            this.sleepTimeMs,
            "fetching block height"
        ) ?? 0;
    }

    async getFeeStatsFromIndexer(blockHeight: number): Promise<{ blockHeight: number, averageFeePerKB: BN, blockTime: BN } | null> {
        try {
            const avgFee = await this.getAvgFeeWithRetry(blockHeight);
            const blockTime = await this.blockchainAPI.getBlockTimeAt(blockHeight);
            return {
                blockHeight: blockHeight,
                averageFeePerKB: toBN(avgFee ?? getDefaultFeePerKB(this.chainType)),
                blockTime: blockTime
            };
        } catch (error) /* istanbul ignore next */ {
            logger.error(`Error fetching fee stats from indexer for block ${blockHeight}: ${errorMessage(error)}`);
            return null;
        }
    }

    async getAvgFeeWithRetry(blockHeight: number, retryLimit = 3): Promise<number | null> {
        return await withRetry(
            () => this.blockchainAPI.getCurrentFeeRate(blockHeight),
            retryLimit,
            this.sleepTimeMs,
            `fetching fee stats for block ${blockHeight}`
        );
    }

    private checkConsecutiveBlocks(): boolean {
        for (let i = 1; i < this.history.length; i++) {
            const currentBlockHeight = this.history[i].blockHeight;
            const previousBlockHeight = this.history[i - 1].blockHeight;

            if (currentBlockHeight !== previousBlockHeight + 1) {
                return false;
            }
        }
        return true;
    }
}
