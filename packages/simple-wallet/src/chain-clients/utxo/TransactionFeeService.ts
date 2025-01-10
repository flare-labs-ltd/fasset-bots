import {
    BTC_LOW_FEE_PER_KB,
    BTC_MID_FEE_PER_KB,
    BTC_MIN_ALLOWED_FEE_PER_KB,
    ChainType,
    DOGE_LOW_FEE_PER_KB,
    DOGE_MID_FEE_PER_KB, DOGE_MIN_ALLOWED_FEE_PER_KB, TEST_BTC_LOW_FEE_PER_KB, TEST_BTC_MID_FEE_PER_KB,
    TEST_DOGE_LOW_FEE_PER_KB,
    TEST_DOGE_MID_FEE_PER_KB,
    UTXO_BLOCK_SIZE_IN_KB,
    UTXO_INPUT_SIZE,
    UTXO_INPUT_SIZE_SEGWIT,
    UTXO_OUTPUT_SIZE,
    UTXO_OUTPUT_SIZE_SEGWIT,
    UTXO_OVERHEAD_SIZE,
    UTXO_OVERHEAD_SIZE_SEGWIT,
} from "../../utils/constants";
import BN from "bn.js";
import { logger } from "../../utils/logger";
import { toBN } from "web3-utils";
import { enforceMinimalAndMaximalFee, getDefaultFeePerKB, getTransactionDescendants } from "./UTXOUtils";
import { EntityManager } from "@mikro-orm/core";
import { TransactionEntity } from "../../entity/transaction";
import { errorMessage } from "../../utils/axios-utils";
import { updateTransactionEntity } from "../../db/dbutils";
import { UTXOBlockchainAPI } from "../../blockchain-apis/UTXOBlockchainAPI";
import { IUtxoWalletServices } from "./IUtxoWalletServices";

export enum FeeStatus {
    LOW, MEDIUM, HIGH
}

export class TransactionFeeService {
    readonly services: IUtxoWalletServices;
    readonly feeIncrease: number;
    readonly chainType: ChainType;
    readonly blockchainAPI: UTXOBlockchainAPI;

    constructor(services: IUtxoWalletServices, chainType: ChainType, feeIncrease: number) {
        this.services = services;
        this.chainType = chainType;
        this.feeIncrease = feeIncrease;
        this.blockchainAPI = services.blockchainAPI;
    }

    /**
     * @returns default fee per kilobyte
     */
    async getFeePerKB(): Promise<BN> {
        try {
            const feeService = this.services.feeService;
            if (feeService) {
                const movingAverageWeightedFee = await feeService.getLatestFeeStats();
                if (movingAverageWeightedFee?.gtn(0)) {
                    return enforceMinimalAndMaximalFee(this.chainType, movingAverageWeightedFee);
                }
            }
        } catch (error) {
            logger.error(`Cannot obtain fee per kb ${errorMessage(error)}`);
        }
        return await this.getCurrentFeeRate();
    }

    async getEstimateFee(inputLength: number, outputLength = 2, feePerKb?: BN ): Promise<BN> {
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

    private async getCurrentFeeRate(): Promise<BN> {
        try {
            const fee = await this.blockchainAPI.getCurrentFeeRate();
            if (fee === 0) {
                return getDefaultFeePerKB(this.chainType);
            }
            const rateInSatoshies = toBN(fee);
            return enforceMinimalAndMaximalFee(this.chainType, rateInSatoshies.muln(this.feeIncrease));
        } catch (error) {
            logger.warn(`Cannot obtain fee rate ${errorMessage(error)}`);
            return getDefaultFeePerKB(this.chainType);
        }
    }

    async calculateTotalFeeOfDescendants(em: EntityManager, oldTx: TransactionEntity): Promise<BN> {
        logger.info(`Calculating total fee of descendants of transaction ${oldTx.id}`);
        const descendants = await getTransactionDescendants(em, oldTx.id);
        let feeToCover: BN = toBN(0);
        /* istanbul ignore next */
        for (const txEnt of descendants) {
            logger.info(`Transaction ${oldTx.id} has descendant ${txEnt.id}`);
            await updateTransactionEntity(em, txEnt.id, (txEnt) => {
                txEnt.ancestor = oldTx;
            });
            feeToCover = feeToCover.add(txEnt.fee ?? new BN(0))
        }
        return feeToCover;
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

    async getSecurityFeePerKB(gain: BN | null, feePerKB: BN, blocksToFill?: number): Promise<BN> {
        if (!gain || !blocksToFill) { // gain = null in case of deleteAccount; blocksToFill is undefined when not paying for redemption
            return feePerKB;
        }
        const cost = feePerKB.muln(UTXO_BLOCK_SIZE_IN_KB * blocksToFill);
        logger.info(`Cost: ${cost.toString()}, Gain: ${gain.toString()}, FeePerKB: ${feePerKB.toString()}, BlocksToFill: ${blocksToFill}`);
        if (cost.gte(gain)) {
            return feePerKB;
        } else {
            const adjustedFeePerKB = gain.divn(UTXO_BLOCK_SIZE_IN_KB * blocksToFill).add(this.getSafetyMargin());
            logger.info(`Using adjustedFeePerKB of ${adjustedFeePerKB}`);
            return adjustedFeePerKB;
        }
    }

    private getSafetyMargin(): BN {
        if (this.chainType === ChainType.testDOGE || this.chainType === ChainType.DOGE) {
            return DOGE_MIN_ALLOWED_FEE_PER_KB;
        } else {
            return BTC_MIN_ALLOWED_FEE_PER_KB;
        }
    }
}
