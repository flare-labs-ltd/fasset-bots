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
    private readonly rootEm: EntityManager;

    readonly calculateFeeBlocks = 3;
    readonly medianTimestampBlocks = 11;

    sleepTimeMs = 10_000;
    setupHistorySleepTimeMs = 1_500;

    constructor(rootEm: EntityManager, blockchainAPI: UTXOBlockchainAPI, chainType: ChainType, monitoringId: string) {
        this.rootEm = rootEm;
        this.chainType = chainType;
        this.blockchainAPI = blockchainAPI;
        this.monitoringId = monitoringId;
        this.feeHistory = new BlockValueHistory(chainType, "averageFeePerKB", this.calculateFeeBlocks * 2);
        this.timestampHistory = new BlockValueHistory(chainType, "timestamp", this.medianTimestampBlocks * 2);
    }

    async getLatestFeeStats(): Promise<BN> {
        if (this.chainType === ChainType.DOGE) { // due to inconsistent transaction distribution in DOGE, fee estimation is unreliable => using the estimateFee API instead
            return toBN(await this.blockchainAPI.getEstimateFee());
        }
        if (this.currentBlockHeight < 0) {
            const blockHeight = await this.getCurrentBlockHeight();
            if (blockHeight) {
                this.currentBlockHeight = blockHeight;
            } else {
                logger.warn(`Stored block height is ${this.currentBlockHeight} and current block height could not be fetched from API`);
            }
        }

        let weightedFeeSum = toBN(0);
        let totalWeight = 0;
        let gettingFeeStatsFromInfo: string[] = [];
        for (let index = 1; index <= this.calculateFeeBlocks; index++) {
            const blockHeight = this.currentBlockHeight - this.calculateFeeBlocks + index;
            const historyFee = this.feeHistory.data.get(blockHeight);

            let fee = historyFee;
            if (!historyFee || historyFee && historyFee.eqn(0)) {
                logger.info(`Fee for block ${blockHeight} is missing or zero. Re-fetching.`);
                fee = await this.feeHistory.loadBlockFromService(this.rootEm, blockHeight, async (bh) => await this.getFeeRateAt(bh));
            }

            fee = fee && fee.gtn(0) ? fee : getDefaultFeePerKB(this.chainType);

            const weight = index;
            weightedFeeSum = weightedFeeSum.add(fee.muln(weight));
            totalWeight += weight;
            gettingFeeStatsFromInfo.push(`blockHeight: ${blockHeight}, fee: ${fee}`);
        }
        const movingAverageWeightedFee = weightedFeeSum.divn(totalWeight);
        logger.info(`Calculated 'getLatestFeeStats': ${movingAverageWeightedFee.toString()} sats/kb at block ${this.currentBlockHeight}, details: ${gettingFeeStatsFromInfo.join("; ")}`);
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
            logger.warn(`Cannot determine latest median time. Current blockHeight is ${this.currentBlockHeight} \n${this.timestampHistory.logHistory()}`);
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
