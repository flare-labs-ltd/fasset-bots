import {
    ChainType,
} from "../utils/constants";
import axios, { AxiosInstance } from "axios";
import { sleepMs } from "../utils/utils";
import { BlockStats, FeeStats, WalletServiceConfigBase } from "../interfaces/IWalletTransaction";
import { toBN } from "../utils/bnutils";
import BN from "bn.js";
import { logger } from "../utils/logger";

import { errorMessage, createAxiosConfig } from "../utils/axios-error-utils";
import { getDefaultFeePerKB } from "../chain-clients/utxo/UTXOUtils";

const FEE_DECILES_COUNT = 11;

export class BlockchainFeeService {
    client: AxiosInstance;
    monitoring = false;
    history: BlockStats[] = [];
    numberOfBlocksInHistory = 5;
    sleepTimeMs = 5000;
    chainType: ChainType;


    constructor(chainType: ChainType, createConfig: WalletServiceConfigBase) {
        const axiosConfig = createAxiosConfig(chainType, createConfig.url, createConfig.rateLimitOptions, createConfig.apiTokenKey);
        this.client = axios .create(axiosConfig);
        this.chainType = chainType;
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
            const weight = index + 1;
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
            if (feeStats.decilesFeePerKB.length == FEE_DECILES_COUNT && feeStats.averageFeePerKB.gtn(0)) {
                if (this.history.length >= this.numberOfBlocksInHistory) {
                    this.history.shift(); //remove first (oldest) block
                }
                this.history.push({
                    blockHeight: blockHeight,
                    averageFeePerKB: feeStats.averageFeePerKB,
                    decilesFeePerKB: feeStats.decilesFeePerKB,
                })
            }
            await sleepMs(this.sleepTimeMs);
        }
    }

    async setupHistory() {
        const currentBlockHeight = await this.getCurrentBlockHeight();
        if (currentBlockHeight == 0) {
            return;
        }
        const feeStatsPromises: Promise<{ blockHeight: number, averageFeePerKB: BN, decilesFeePerKB: BN[] }>[] = [];
        for (let i = 0; i < this.numberOfBlocksInHistory; i++) {
            feeStatsPromises.push(this.getFeeStatsFromIndexer(currentBlockHeight - i));
        }
        const feeStatsResults = await Promise.all(feeStatsPromises);

        for (let i = 0; i < this.numberOfBlocksInHistory; i++) {
            const avgFeePerKB = feeStatsResults[i].averageFeePerKB;
            this.history[this.numberOfBlocksInHistory - 1 - i] = {
                blockHeight: currentBlockHeight - i,
                averageFeePerKB: avgFeePerKB.eqn(0) ? getDefaultFeePerKB(this.chainType) : avgFeePerKB,
                decilesFeePerKB: feeStatsResults[i].decilesFeePerKB,
            };
        }
    }

    stopMonitoringFees() {
        logger.info("Stopped monitoring fees");
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

    async getFeeStatsFromIndexer(blockHeight: number): Promise<{ blockHeight: number, averageFeePerKB: BN, decilesFeePerKB: BN[] }> {
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
}