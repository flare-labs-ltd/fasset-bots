import {
    BTC_DOGE_DEC_PLACES,
    ChainType,
} from "../utils/constants";
import { sleepMs } from "../utils/utils";
import { BlockStats } from "../interfaces/IWalletTransaction";
import { toBN, toBNExp } from "../utils/bnutils";
import BN from "bn.js";
import { logger } from "../utils/logger";

import { errorMessage } from "../utils/axios-error-utils";
import { getDefaultFeePerKB } from "../chain-clients/utxo/UTXOUtils";
import { BlockchainAPIWrapper } from "../blockchain-apis/UTXOBlockchainAPIWrapper";
import { ServiceRepository } from "../ServiceRepository";

export class BlockchainFeeService {
    blockchainAPI: BlockchainAPIWrapper;
    monitoring = false;
    history: BlockStats[] = [];
    numberOfBlocksInHistory = 11;
    sleepTimeMs = 5000;
    chainType: ChainType;
    useNBlocksToCalculateFee: number = 5;


    constructor(chainType: ChainType) {
        this.chainType = chainType;
        this.blockchainAPI = ServiceRepository.get(this.chainType, BlockchainAPIWrapper);
    }

    getLatestFeeStats(): BN {
        const totalBlocks = this.history.length;
        if (totalBlocks === 0) {
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
        if (this.history.length < this.numberOfBlocksInHistory) {
            logger.warn("Insufficient block data for MTP calculation");
            return null;
        }
        const blockTimes = this.history.map(block => block.blockTime);
        blockTimes.sort((a, b) => a.sub(b).toNumber());
        const lastStoredBlockHeight = this.history[this.history.length - 1]?.blockHeight;
        return blockTimes[Math.floor(blockTimes.length / 2)];
    }

    async startMonitoringFees(): Promise<void> {
        logger.info("Started monitoring fees");
        this.monitoring = true;
        await this.setupHistory();

        while (this.monitoring) {
            const currentBlockHeight = await this.getCurrentBlockHeight();
            const lastStoredBlockHeight = this.history[this.history.length - 1]?.blockHeight;
            if (!currentBlockHeight || currentBlockHeight <= lastStoredBlockHeight) {
                await sleepMs(this.sleepTimeMs);
                continue;
            }

            let blockHeightToFetch = lastStoredBlockHeight + 1;
            while (blockHeightToFetch <= currentBlockHeight) {
                const feeStats = await this.getFeeStatsWithRetry(blockHeightToFetch);
                if (feeStats) {
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
    }

    async setupHistory(): Promise<void> {
        const currentBlockHeight = await this.getCurrentBlockHeight();
        if (currentBlockHeight === 0) {
            return;
        }
        let blockHeightToFetch = currentBlockHeight;
        while (this.history.length < this.numberOfBlocksInHistory) {
            const feeStats = await this.getFeeStatsWithRetry(blockHeightToFetch);
            if (feeStats) {
                this.history.unshift({
                    blockHeight: blockHeightToFetch,
                    averageFeePerKB: feeStats.averageFeePerKB,
                    blockTime: feeStats.blockTime,
                });
                blockHeightToFetch--;
            } else {
                logger.error(`Failed to retrieve fee stats for block ${blockHeightToFetch} during history setup.`);
                continue;
            }
        }
    }

    stopMonitoringFees() {
        logger.info("Stopped monitoring fees");
        this.monitoring = false;
    }

    async getCurrentBlockHeight() {
        try {
            const blockHeight = await this.blockchainAPI.getCurrentBlockHeight()
            return blockHeight;
        } catch (error) {
            logger.error(`Fee service failed to fetch block height ${errorMessage(error)}`);
            return 0;
        }
    }

    async getFeeStatsFromIndexer(blockHeight: number): Promise<{ blockHeight: number, averageFeePerKB: BN, blockTime: BN } | null> {
        try {
            const avgFee = await this.blockchainAPI.getCurrentFeeRate(blockHeight);
            const blockTime = await this.blockchainAPI.getBlockTimeAt(blockHeight);
            return {
                blockHeight: blockHeight,
                averageFeePerKB: toBNExp(avgFee, BTC_DOGE_DEC_PLACES),
                blockTime: blockTime
            };
        } catch (error) {
            logger.error(`Error fetching fee stats from indexer for block ${blockHeight}: ${errorMessage(error)}`);
            return null;
        }
    }

    async getFeeStatsWithRetry(blockHeight: number, retryLimit = 3): Promise<{ blockHeight: number, averageFeePerKB: BN, blockTime: BN } | null> {
        let attempts = 0;
        while (attempts < retryLimit) {
            try {
                const feeStats = await this.getFeeStatsFromIndexer(blockHeight);
                if (feeStats) {
                    return feeStats;
                }
            } catch (error) {
                logger.warn(`Failed to fetch fee stats for block ${blockHeight} on attempt ${attempts + 1}: ${errorMessage(error)}`);
            }
            attempts++;
            await sleepMs(this.sleepTimeMs); // Wait before retrying
        }
        logger.error(`Failed to fetch fee stats for block ${blockHeight} after ${retryLimit} attempts.`);
        return null;
    }
}