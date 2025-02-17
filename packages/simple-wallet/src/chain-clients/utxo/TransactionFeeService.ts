import {
    ChainType,
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

    private async getCurrentFeeRate(): Promise<BN> {
        try {
            let fee: number;
            if (this.chainType === ChainType.DOGE) { // due to inconsistent transaction distribution in DOGE, avg and medium fee per block is unreliable => using the estimateFee API instead
                fee = await this.blockchainAPI.getEstimateFee();
            } else {
                fee = await this.blockchainAPI.getCurrentFeeRate();
            }
            if (fee === 0) {
                return getDefaultFeePerKB(this.chainType);
            }
            const rateInSatoshies = toBN(Math.round(fee));
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
}