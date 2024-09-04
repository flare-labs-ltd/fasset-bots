import axiosRateLimit from "../axios-rate-limiter/axios-rate-limit";
import {
    DEFAULT_RATE_LIMIT_OPTIONS, DEFAULT_RATE_LIMIT_OPTIONS_FEE_SERVICE,
} from "../utils/constants";
import axios, {AxiosInstance, AxiosRequestConfig} from "axios";
import {excludeNullFields, sleepMs} from "../utils/utils";
import {BlockStats, FeeServiceConfig} from "../interfaces/IWalletTransaction";
import {toBN} from "../utils/bnutils";
import BN from "bn.js";
import {logger} from "../utils/logger";
import { errorMessage } from "../chain-clients/utils";

export class FeeService {
    client: AxiosInstance;

    private monitoring: boolean = true;
    private history: BlockStats[];

    private numberOfBlocksInHistory;
    private sleepTimeMs;
    private currentHistoryIndex = 0;

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

        this.history = [];
    }

    async getLatestFeeStats() {
        return {
            averageFeePerKB: this.history[this.currentHistoryIndex]?.averageFeePerKB ?? toBN(0),
            decilesFeePerKB: this.history[this.currentHistoryIndex]?.decilesFeePerKB ?? [],
        }
    }

    async startMonitoringFees(): Promise<void> {
        logger.info("Started monitoring fees");

        while (this.monitoring) {
            const blockHeight = await this.getCurrentBlockHeight();
            if (!blockHeight || blockHeight == this.history[this.currentHistoryIndex].blockHeight) {
                await sleepMs(this.sleepTimeMs);
                continue;
            }

            const feeStats = await this.getFeeStatsFromIndexer(blockHeight);
            const blockTime = await this.getBlockTime(blockHeight);
            if (feeStats.decilesFeePerKB.length == 11 && feeStats.averageFeePerKB.gtn(0) && blockTime > 0) {
                logger.info("Updating fee history");
                this.history[this.currentHistoryIndex % this.numberOfBlocksInHistory] = {
                    blockHeight: blockHeight,
                    blockTime: blockTime,
                    timeSincePreviousBlock: blockTime - this.history[Math.abs((this.currentHistoryIndex - 1) % this.numberOfBlocksInHistory)].blockTime,
                    averageFeePerKB: feeStats.averageFeePerKB,
                    decilesFeePerKB: feeStats.decilesFeePerKB,
                }
                this.currentHistoryIndex += 1;
                if (this.currentHistoryIndex == this.numberOfBlocksInHistory) {
                    this.currentHistoryIndex = 0;
                }
            }

            await sleepMs(this.sleepTimeMs);
        }

        logger.info("Stopped monitoring fees");
    }

    async setupHistory() {
        const currentBlockHeight = await this.getCurrentBlockHeight() - 1;

        if (!currentBlockHeight) {
            return;
        }

        for (let i = 0; i < this.numberOfBlocksInHistory; i++) {
            const feeStats = await this.getFeeStatsFromIndexer(currentBlockHeight - i);
            const blockTime = await this.getBlockTime(currentBlockHeight - i);

            this.history[this.numberOfBlocksInHistory - 1 - i] = {
                blockHeight: currentBlockHeight - i,
                blockTime: blockTime,
                timeSincePreviousBlock: 0,
                averageFeePerKB: feeStats.averageFeePerKB,
                decilesFeePerKB: feeStats.decilesFeePerKB,
            }
        }
        for (let i = 1; i < this.numberOfBlocksInHistory; i++) {
            this.history[i].timeSincePreviousBlock = this.history[i].blockTime - this.history[i - 1].blockTime;
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
        } catch (e) {
            return {blockHeight: blockHeight, averageFeePerKB: toBN(0), decilesFeePerKB: []};
        }
    }

    async getBlockTime(blockHeight: number) {
        try {
            const response = await this.client.get(`/block/${blockHeight}`);
            return response.data?.time ?? 0;
        } catch (e) {
            return 0;
        }
    }
}