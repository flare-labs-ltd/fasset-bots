import {
    BTC_DOGE_DEC_PLACES,
    BTC_LOW_FEE_PER_KB,
    BTC_MID_FEE_PER_KB,
    ChainType,
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
import { toBNExp } from "../../utils/bnutils";
import { logger } from "../../utils/logger";
import { toBN } from "web3-utils";
import { BlockchainFeeService } from "../../fee-service/fee-service";
import { enforceMinimalAndMaximalFee, getDefaultFeePerKB, getTransactionDescendants } from "./UTXOUtils";
import { EntityManager } from "@mikro-orm/core";
import { TransactionEntity } from "../../entity/transaction";
import { errorMessage } from "../../utils/axios-utils";
import { updateTransactionEntity } from "../../db/dbutils";
import { UTXOBlockchainAPI } from "../../blockchain-apis/UTXOBlockchainAPI";

export enum FeeStatus {
    LOW, MEDIUM, HIGH
}

export class TransactionFeeService {
    readonly feeIncrease: number;
    readonly chainType: ChainType;
    readonly blockchainAPI: UTXOBlockchainAPI;

    constructor(chainType: ChainType, feeIncrease: number) {
        this.chainType = chainType;
        this.feeIncrease = feeIncrease;
        this.blockchainAPI = ServiceRepository.get(this.chainType, UTXOBlockchainAPI);
    }

    /**
     * @returns default fee per kilobyte
     */
    async getFeePerKB(): Promise<BN> {
        try {
            const feeService = ServiceRepository.get(this.chainType, BlockchainFeeService);
            const movingAverageWeightedFee = feeService.getLatestFeeStats();
            if (movingAverageWeightedFee?.gtn(0)) {
                return enforceMinimalAndMaximalFee(this.chainType, movingAverageWeightedFee);
            } else {
                return await this.getCurrentFeeRate();
            }
        } catch (error) {
            logger.error(`Cannot obtain fee per kb ${errorMessage(error)}`);
            return await this.getCurrentFeeRate();
        }
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
            if (fee.toString() === "-1" || fee === 0) {
                throw new Error(`Cannot obtain fee rate: ${fee.toString()}`);
            }
            const rateInSatoshies = toBNExp(fee, BTC_DOGE_DEC_PLACES);
            return enforceMinimalAndMaximalFee(this.chainType, rateInSatoshies.muln(this.feeIncrease));
        } catch (e) {
            logger.error(`Cannot obtain fee rate ${errorMessage(e)}`);
            return getDefaultFeePerKB(this.chainType);
        }
    }

    async calculateTotalFeeOfDescendants(em: EntityManager, oldTx: TransactionEntity): Promise<BN> {
        const descendants = await getTransactionDescendants(em, oldTx.transactionHash!, oldTx.source);
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
}
