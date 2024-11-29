import { EntityManager } from "@mikro-orm/core";
import BN from "bn.js";
import { UTXOBlockchainAPI } from "../blockchain-apis/UTXOBlockchainAPI";
import { getDefaultFeePerKB } from "../chain-clients/utxo/UTXOUtils";
import { errorMessage } from "../utils/axios-utils";
import { toBN } from "../utils/bnutils";
import { ChainType } from "../utils/constants";
import { logger } from "../utils/logger";
import { sleepMs } from "../utils/utils";
import { BlockValueHistory } from "./block-value-history";

export class BlockchainFeeService {
    blockchainAPI: UTXOBlockchainAPI;
    chainType: ChainType;
    monitoringId: string;
    feeHistory: BlockValueHistory;
    timestampHistory: BlockValueHistory;
    currentBlockHeight: number = -1;
    initialSetup: boolean = true;
    running: boolean = false;

    readonly calculateFeeBlocks = 3;
    readonly medianTimestampBlocks = 11;

    sleepTimeMs = 10_000;
    setupHistorySleepTimeMs = 1_500;

    constructor(blockchainAPI: UTXOBlockchainAPI, chainType: ChainType, monitoringId: string) {
        this.chainType = chainType;
        this.blockchainAPI = blockchainAPI;
        this.monitoringId = monitoringId;
        this.feeHistory = new BlockValueHistory(chainType, "averageFeePerKB", this.calculateFeeBlocks * 2);
        this.timestampHistory = new BlockValueHistory(chainType, "timestamp", this.medianTimestampBlocks * 2);
    }

    getLatestFeeStats(): BN {
        const defaultFee = getDefaultFeePerKB(this.chainType);
        let weightedFeeSum = toBN(0);
        let totalWeight = 0;
        for (let index = 1; index <= this.calculateFeeBlocks; index++) {
            const blockHeight = this.currentBlockHeight - this.calculateFeeBlocks + index;
            const fee = this.feeHistory.data.get(blockHeight) ?? defaultFee;
            const weight = index;
            weightedFeeSum = weightedFeeSum.add(fee.muln(weight));
            totalWeight += weight;
        }
        const movingAverageWeightedFee = weightedFeeSum.divn(totalWeight);
        return movingAverageWeightedFee;
    }

    getLatestMedianTime(): BN | null {
        this.checkEnoughTimestampHistory();
        const blocks = this.timestampHistory.sortedData().slice(-this.medianTimestampBlocks);
        const latestMedianTime = blocks[Math.floor(blocks.length / 2)].value;
        return latestMedianTime;
    }

    checkEnoughTimestampHistory() {
        /* istanbul ignore if */
        if (!this.hasEnoughTimestampHistory()) {
            logger.warn(`Cannot determine latest median time.\n${this.timestampHistory.logHistory()}`);
        }
    }

    hasEnoughTimestampHistory(): boolean {
        return this.currentBlockHeight > 0 && this.timestampHistory.consecutiveLength(this.currentBlockHeight) >= this.medianTimestampBlocks;
    }

    async monitorFees(rootEm: EntityManager, monitoring: () => boolean): Promise<void> {
        if (this.running) {
            logger.info(`Fee service for ${this.monitoringId} already running.`)
            return;
        }
        if (this.initialSetup) {
            logger.info(`Starting initial setup for fee service ${this.monitoringId}.`)
        }
        try {
            this.running = true;
            logger.info(`${this.monitoringId}: Started monitoring fees and timestamps.`);
            await this.timestampHistory.loadFromDb(rootEm);
            await this.feeHistory.loadFromDb(rootEm);
            while (monitoring()) {
                await this.obtainFeesAndTimestamps(rootEm, monitoring);
            }
            logger.info(`${this.monitoringId}: Stopped monitoring fees and timestamps.`);
        } catch (error) {
            // should never happen
            logger.error(`${this.monitoringId}: Unexpected error monitoring fees and timestamps, stopped.`);
        } finally {
            this.running = false;
        }
    }

    async obtainFeesAndTimestamps(rootEm: EntityManager, monitoring: () => boolean) {
        const currentBlockHeight = await this.getCurrentBlockHeight();
        if (currentBlockHeight) {
            for (let blockHeight = currentBlockHeight - this.medianTimestampBlocks + 1; blockHeight <= currentBlockHeight; blockHeight++) {
                if (!monitoring()) break;
                await this.timestampHistory.loadBlockFromService(rootEm, blockHeight, async (bh) => await this.getBlockTimeAt(bh));
            }
            this.currentBlockHeight = currentBlockHeight;
            if (this.initialSetup) {
                this.checkEnoughTimestampHistory();
                logger.info(`Timestamp history setup complete for fee service ${this.monitoringId}.`);
            }
            for (let blockHeight = currentBlockHeight - this.calculateFeeBlocks + 1; blockHeight <= currentBlockHeight; blockHeight++) {
                if (!monitoring()) break;
                await this.feeHistory.loadBlockFromService(rootEm, blockHeight, async (bh) => await this.getFeeRateAt(bh));
            }
            if (this.initialSetup) {
                logger.info(`Fee history setup complete for fee service ${this.monitoringId}.`);
                this.initialSetup = false;
            }
        }
        if (monitoring()) {
            await sleepMs(this.initialSetup ? this.setupHistorySleepTimeMs : this.sleepTimeMs);
        }
    }

    private async getBlockTimeAt(blockHeight: number) {
        return await this.blockchainAPI.getBlockTimeAt(blockHeight);
    }

    private async getFeeRateAt(blockHeight: number) {
        const currentFeeRate = await this.blockchainAPI.getCurrentFeeRate(blockHeight);
        return toBN(currentFeeRate);
    }

    async getCurrentBlockHeight() {
        try {
            const blockHeight = await this.blockchainAPI.getCurrentBlockHeight()
            return blockHeight;
        } catch (error) /* istanbul ignore next */ {
            logger.error(`Fee service failed to fetch block height ${errorMessage(error)}`);
            return null;
        }
    }
}
