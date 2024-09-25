import { IService } from "../../interfaces/IService";
import {
    BTC_DOGE_DEC_PLACES,
    BTC_LOW_FEE_PER_KB,
    BTC_MAX_ALLOWED_FEE,
    BTC_MID_FEE_PER_KB,
    BTC_MIN_ALLOWED_FEE,
    ChainType,
    DEFAULT_FEE_INCREASE,
    DOGE_LOW_FEE_PER_KB,
    DOGE_MID_FEE_PER_KB, TEST_BTC_LOW_FEE_PER_KB, TEST_BTC_MID_FEE_PER_KB,
    TEST_DOGE_LOW_FEE_PER_KB,
    TEST_DOGE_MID_FEE_PER_KB,
    UTXO_INPUT_SIZE,
    UTXO_INPUT_SIZE_SEGWIT,
    UTXO_OUTPUT_SIZE,
    UTXO_OUTPUT_SIZE_SEGWIT,
    UTXO_OVERHEAD_SIZE,
    UTXO_OVERHEAD_SIZE_SEGWIT,
} from "../../utils/constants";
import BN from "bn.js";
import { ServiceRepository } from "../../ServiceRepository";
import { BlockchainAPIWrapper } from "../../blockchain-apis/UTXOBlockchainAPIWrapper";
import { toBNExp } from "../../utils/bnutils";
import { logger } from "../../utils/logger";
import { toBN } from "web3-utils";
import { BlockchainFeeService } from "../../fee-service/service";
import { UTXOFeeParams } from "../../interfaces/IWalletTransaction";
import { getDefaultFeePerKB, getEstimatedNumberOfOutputs, getTransactionDescendants } from "./UTXOUtils";
import { EntityManager } from "@mikro-orm/core";
import { TransactionEntity } from "../../entity/transaction";
import { errorMessage } from "../../utils/axios-error-utils";
import { updateTransactionEntity } from "../../db/dbutils";

export enum FeeStatus {
    LOW, MEDIUM, HIGH
}

export class TransactionFeeService implements IService {
    readonly feeDecileIndex: number;
    readonly feeIncrease: number;
    readonly relayFeePerB: number;
    readonly chainType: ChainType;

    constructor(chainType: ChainType, feeDecileIndex: number, feeIncrease: number, relayFeePerB: number) {
        this.chainType = chainType;
        this.feeDecileIndex = feeDecileIndex;
        this.feeIncrease = feeIncrease;
        this.relayFeePerB = relayFeePerB;
    }

    /**
     * @returns default fee per kilobyte
     */
    async getFeePerKB(): Promise<BN> {
        try {
            const feeService = ServiceRepository.get(this.chainType, BlockchainFeeService);
            const feeStats = await feeService.getLatestFeeStats();
            if (feeStats.decilesFeePerKB.length == 11) {// In testDOGE there's a lot of blocks with empty deciles and 0 avg fee
                const fee = feeStats.decilesFeePerKB[this.feeDecileIndex];
                return this.enforceMinimalAndMaximalFee(this.chainType, fee.muln(this.feeIncrease ?? DEFAULT_FEE_INCREASE));
            } else if (feeStats.averageFeePerKB.gtn(0)) {
                const fee = feeStats.averageFeePerKB;
                return this.enforceMinimalAndMaximalFee(this.chainType, fee.muln(this.feeIncrease ?? DEFAULT_FEE_INCREASE));
            }
            return await this.getCurrentFeeRate();
        } catch (error) {
            return await this.getCurrentFeeRate();
        }
    }

    async getEstimateFee(inputLength: number, outputLength: number = 2, feePerKb?: BN ): Promise<BN> {
        let feePerKbToUse: BN;
        if (feePerKb) {
            feePerKbToUse = feePerKb;
        } else {
            feePerKbToUse =  await this.getFeePerKB();
        }
        const feePerb = feePerKbToUse.divn(1000);
        if (this.chainType === ChainType.DOGE || this.chainType === ChainType.testDOGE) {
            return feePerb.muln(inputLength * UTXO_INPUT_SIZE + outputLength * UTXO_OUTPUT_SIZE + UTXO_OVERHEAD_SIZE);
        } else {
            return feePerb.muln(inputLength * UTXO_INPUT_SIZE_SEGWIT + outputLength * UTXO_OUTPUT_SIZE_SEGWIT + UTXO_OVERHEAD_SIZE_SEGWIT);
        }
    }

    private async getCurrentFeeRate(nextBlocks: number = 12): Promise<BN> {
        try {
            const fee = await ServiceRepository.get(this.chainType, BlockchainAPIWrapper).getCurrentFeeRate(nextBlocks);
            if (fee.toString() === "-1" || fee === 0) {
                throw new Error(`Cannot obtain fee rate: ${fee.toString()}`);
            }
            const rateInSatoshies = toBNExp(fee, BTC_DOGE_DEC_PLACES);
            return this.enforceMinimalAndMaximalFee(this.chainType, rateInSatoshies.muln(this.feeIncrease ?? DEFAULT_FEE_INCREASE));
        } catch (e) {
            logger.error(`Cannot obtain fee rate ${errorMessage(e)}`);
            return getDefaultFeePerKB(this.chainType);
        }
    }

    /**
     * @param {UTXOFeeParams} params - basic data needed to estimate fee
     * @returns {BN} - current transaction/network fee in satoshis
     */
    async getCurrentTransactionFee(params: UTXOFeeParams): Promise<BN> {
        try {
            const utxos = await ServiceRepository.get(this.chainType, BlockchainAPIWrapper).getUTXOsFromMempool(params.source, this.chainType);
            const numOfOut = getEstimatedNumberOfOutputs(params.amount, params.note);
            let est_fee = await this.getEstimateFee(utxos.length, numOfOut);

            if (params.amount == null) {
                return est_fee;
            } else {
                const neededUTXOs: any[] = [];
                let sum = toBN(0);
                for (const utxo of utxos) {
                    neededUTXOs.push(utxo);
                    sum = sum.add(toBN(utxo.value));
                    est_fee = await this.getEstimateFee(neededUTXOs.length, numOfOut);
                    if (sum.gt(params.amount.add(est_fee))) {
                        break;
                    }
                }
                return est_fee;
            }
        } catch (error) {
            logger.error(`Cannot get current transaction fee for params ${params.source}, ${params.destination} and ${params.amount}: ${errorMessage(error)}`);
            throw error;
        }
    }

    async calculateTotalFeeOfDescendants(em: EntityManager, oldTx: TransactionEntity): Promise<BN> {
        const descendants = await getTransactionDescendants(em, oldTx.transactionHash!, oldTx.source);
        let feeToCover: BN = toBN(0);
        for (const txEnt of descendants) {
            logger.info(`Transaction ${oldTx.id} has descendant ${txEnt.id}`);
            await updateTransactionEntity(em, txEnt.id, async (txEnt) => {
                txEnt.ancestor = oldTx;
            });
            feeToCover = feeToCover.add(txEnt.fee ?? new BN(0))
        }
        return feeToCover;
    }

    enforceMinimalAndMaximalFee(chainType: ChainType, feePerKB: BN): BN {
        if (chainType == ChainType.DOGE || chainType == ChainType.testDOGE) {
            return feePerKB;
        } else {
            const minFee = BTC_MIN_ALLOWED_FEE;
            const maxFee = BTC_MAX_ALLOWED_FEE;
            if (feePerKB.lt(minFee)) {
                return minFee;
            } else if (feePerKB.gt(maxFee)) {
                return maxFee;
            }
            else {
                return feePerKB;
            }
        }
    }

    async getCurrentFeeStatus(): Promise<FeeStatus> {
        const fee = await this.getFeePerKB();
        switch (this.chainType) {
            case ChainType.DOGE:
                return this.getFeeStatusForChain(fee, DOGE_LOW_FEE_PER_KB, DOGE_MID_FEE_PER_KB);
            case ChainType.testDOGE:
                return this.getFeeStatusForChain(fee, TEST_DOGE_LOW_FEE_PER_KB, TEST_DOGE_MID_FEE_PER_KB);
            case ChainType.BTC:
                return this.getFeeStatusForChain(fee, BTC_LOW_FEE_PER_KB, BTC_MID_FEE_PER_KB);
            case ChainType.testBTC:
                return this.getFeeStatusForChain(fee, TEST_BTC_LOW_FEE_PER_KB, TEST_BTC_MID_FEE_PER_KB);
            default:
                return FeeStatus.MEDIUM;
        }
    }

    private getFeeStatusForChain(fee: BN, lowFee: BN, medium: BN): FeeStatus {
        if (fee.lt(lowFee)) { // 0,05 DOGE/kB
            return FeeStatus.LOW;
        } else if (fee.lt(medium)) { // 0,4 DOGE/kB
            return FeeStatus.MEDIUM;
        } else {
            return FeeStatus.HIGH;
        }
    }
}
