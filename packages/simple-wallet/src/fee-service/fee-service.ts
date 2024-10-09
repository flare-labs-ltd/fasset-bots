import axiosRateLimit from "../axios-rate-limiter/axios-rate-limit";
import {
    DEFAULT_RATE_LIMIT_OPTIONS, DEFAULT_RATE_LIMIT_OPTIONS_FEE_SERVICE,
    DOGE_DEFAULT_FEE_PER_KB,
} from "../utils/constants";
import axios, {AxiosInstance, AxiosRequestConfig} from "axios";
import {excludeNullFields, sleepMs} from "../utils/utils";
import {BlockStats, FeeServiceConfig} from "../interfaces/IWalletTransaction";
import {toBN} from "../utils/bnutils";
import BN from "bn.js";
import {logger} from "../utils/logger";

import { IService } from "../interfaces/IService";
import { errorMessage } from "../utils/axios-error-utils";

const FEE_DECILES_COUNT = 11;
export interface FeeStats {
    averageFeePerKB: BN,
    decilesFeePerKB: BN[],
    movingAverageWeightedFee: BN
}
export class BlockchainFeeService implements IService {
    client: AxiosInstance;
    monitoring: boolean = false;
    history: BlockStats[] = [];
    numberOfBlocksInHistory;
    sleepTimeMs;

    constructor(config: FeeServiceConfig) {
        const createAxiosConfig: AxiosRequestConfig = {
            headers: excludeNullFields({
                "Content-Type": "application/json",
            }),
            timeout: config.rateLimitOptions?.timeoutMs ?? DEFAULT_RATE_LIMIT_OPTIONS_FEE_SERVICE.timeoutMs,
            baseURL: config.indexerUrl,
        };

        const client = axios.create(createAxiosConfig);
        this.client = axiosRateLimit(client, {
            ...DEFAULT_RATE_LIMIT_OPTIONS,
            ...config.rateLimitOptions,
        });
        this.numberOfBlocksInHistory = config.numberOfBlocksInHistory;
        this.sleepTimeMs = config.sleepTimeMs;
    }

    getLatestFeeStats(): FeeStats {
        const totalBlocks = this.history.length;

        if (totalBlocks === 0) {
            return {
                averageFeePerKB: toBN(0),
                decilesFeePerKB: [],
                movingAverageWeightedFee: toBN(0),
            };
        }

        let weightedFeeSum = toBN(0);
        let totalWeight = 0;
        this.history.forEach((block, index) => {
            const weight = totalBlocks - index;
            weightedFeeSum = weightedFeeSum.add(block.averageFeePerKB.muln(weight));
            totalWeight += weight;
        });
        const movingAverageWeightedFee = weightedFeeSum.divn(totalWeight);
        const latestBlockIndex = totalBlocks - 1;
        const currentHistory = this.history[latestBlockIndex];

        return {
            averageFeePerKB: currentHistory?.averageFeePerKB ?? toBN(0),
            decilesFeePerKB: currentHistory?.decilesFeePerKB ?? [],
            movingAverageWeightedFee: movingAverageWeightedFee,
        };
    }

    async startMonitoringFees(): Promise<void> {
        logger.info("Started monitoring fees");
        this.monitoring = true;
        await this.setupHistory();
        while (this.monitoring) {
            const blockHeight = await this.getCurrentBlockHeight();
            if (!blockHeight || blockHeight == this.history[this.history.length - 1]?.blockHeight) {
                await sleepMs(this.sleepTimeMs);
                continue;
            }
            const feeStats = await this.getFeeStatsFromIndexer(blockHeight);
            const blockTime = await this.getBlockTime(blockHeight);
            if (feeStats.decilesFeePerKB.length == FEE_DECILES_COUNT && feeStats.averageFeePerKB.gtn(0) && blockTime > 0) {
                if (this.history.length >= this.numberOfBlocksInHistory) {
                    this.history.shift(); //remove first (oldest) block
                }
                this.history.push({
                    blockHeight: blockHeight,
                    blockTime: blockTime,
                    timeSincePreviousBlock: blockTime - this.history[this.history.length - 1]?.blockTime || 0,
                    averageFeePerKB: feeStats.averageFeePerKB,
                    decilesFeePerKB: feeStats.decilesFeePerKB,
                })
            }
            await sleepMs(this.sleepTimeMs);
        }
        logger.info("Stopped monitoring fees");
    }

    async setupHistory() {
        const currentBlockHeight = await this.getCurrentBlockHeight();
        if (currentBlockHeight == 0) {
            return;
        }
        const feeStatsPromises = [];
        const blockTimePromises = [];
        for (let i = 0; i < this.numberOfBlocksInHistory; i++) {
            feeStatsPromises.push(this.getFeeStatsFromIndexer(currentBlockHeight - i));
            blockTimePromises.push(this.getBlockTime(currentBlockHeight - i));
        }
        const feeStatsResults = await Promise.all(feeStatsPromises);
        const blockTimeResults = await Promise.all(blockTimePromises);

        for (let i = 0; i < this.numberOfBlocksInHistory; i++) {
            const avgFeePerKB = feeStatsResults[i].averageFeePerKB;
            this.history[this.numberOfBlocksInHistory - 1 - i] = {
                blockHeight: currentBlockHeight - i,
                blockTime: blockTimeResults[i],
                timeSincePreviousBlock: 0,
                averageFeePerKB: avgFeePerKB.eqn(0) ? DOGE_DEFAULT_FEE_PER_KB : avgFeePerKB,
                decilesFeePerKB: feeStatsResults[i].decilesFeePerKB,
            };
        }
        for (let i = 1; i < this.numberOfBlocksInHistory; i++) {
            if (this.history[i] && this.history[i - 1]) {
                this.history[i].timeSincePreviousBlock = this.history[i].blockTime - this.history[i - 1].blockTime;
            }
        }
    }

    stopMonitoring() {
        this.monitoring = false;
    }

    async getCurrentBlockHeight() {
        try {
            const response = await this.client.get(``);
            return response.data?.blockbook?.bestHeight ?? 0;
        } catch (error) {
            logger.error(`Fee service failed to fetch block height ${errorMessage(error)}`);
            return 0;
        }
    }

    async getFeeStatsFromIndexer(blockHeight: number) {
        try {
            const response = await this.client.get(`/feestats/${blockHeight}`);
            const fees = response.data.decilesFeePerKb.filter((t: number) => t >= 0).map((t: number) => toBN(t));

            return {
                blockHeight: blockHeight,
                averageFeePerKB: toBN(response.data.averageFeePerKb ?? 0),
                decilesFeePerKB: fees.every((t: BN) => t.isZero()) ? [] : fees,
            };
        } catch (error) {
            logger.error(`Error fetching fee stats from indexer for block ${blockHeight}: ${errorMessage(error)}`);
            return {blockHeight: blockHeight, averageFeePerKB: toBN(0), decilesFeePerKB: []};
        }
    }

    async getBlockTime(blockHeight: number) {
        try {
            const response = await this.client.get(`/block/${blockHeight}`);
            return response.data?.time ?? null;
        } catch (error) {
            logger.error(`Error fetching block time for block ${blockHeight}: ${errorMessage(error)}`);
            return 0;
        }
    }
}