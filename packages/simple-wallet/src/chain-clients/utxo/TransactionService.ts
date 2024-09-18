import { IService } from "../../interfaces/IService";
import BN from "bn.js";
import { logger } from "../../utils/logger";
import {
    checkIfIsDeleting,
    createInitialTransactionEntity, setAccountIsDeleting,
} from "../../db/dbutils";
import { ServiceRepository } from "../../ServiceRepository";
import { EntityManager } from "@mikro-orm/core";
import { ChainType } from "../../utils/constants";
import { TransactionEntity } from "../../entity/transaction";
import { UTXOEntity } from "../../entity/utxo";
import * as bitcore from "bitcore-lib";
import { Transaction } from "bitcore-lib";
import {
    getAccountBalance,
    getCore,
    getDustAmount,
    getEstimatedNumberOfOutputs,

} from "./UTXOUtils";
import { unPrefix0x } from "../../utils/utils";
import UnspentOutput = Transaction.UnspentOutput;
import { toBN, toNumber } from "../../utils/bnutils";
import { TransactionUTXOService } from "./TransactionUTXOService";
import { TransactionFeeService } from "./TransactionFeeService";
import { LessThanDustAmountError, NotEnoughUTXOsError } from "../../utils/axios-error-utils";

export class TransactionService implements IService {

    private readonly chainType: ChainType;
    private readonly transactionFeeService: TransactionFeeService;

    constructor(chainType: ChainType) {
        this.chainType = chainType;
        this.transactionFeeService = ServiceRepository.get(this.chainType, TransactionFeeService);
    }

    async createPaymentTransaction(
        chainType: ChainType,
        source: string,
        destination: string,
        amountInSatoshi: BN | null,
        feeInSatoshi?: BN,
        note?: string,
        maxFeeInSatoshi?: BN,
        executeUntilBlock?: number,
        executeUntilTimestamp?: BN,
    ): Promise<number> {
        logger.info(`Received request to create transaction from ${source} to ${destination} with amount ${amountInSatoshi} and reference ${note}, with limits ${executeUntilBlock} and ${executeUntilTimestamp}`);
        const em = ServiceRepository.get(this.chainType, EntityManager);
        if (await checkIfIsDeleting(em, source)) {
            logger.error(`Cannot receive requests. ${source} is deleting`);
            throw new Error(`Cannot receive requests. ${source} is deleting`);
        }
        const ent = await createInitialTransactionEntity(
            em,
            chainType,
            source,
            destination,
            amountInSatoshi,
            feeInSatoshi,
            note,
            maxFeeInSatoshi,
            executeUntilBlock,
            executeUntilTimestamp,
        );
        return ent.id;
    }

    async createDeleteAccountTransaction(
        chainType: ChainType,
        source: string,
        destination: string,
        feeInSatoshi?: BN,
        note?: string,
        maxFeeInSatoshi?: BN,
        executeUntilBlock?: number,
        executeUntilTimestamp?: BN,
    ): Promise<number> {
        logger.info(`Received request to delete account from ${source} to ${destination} with reference ${note}`);
        const em = ServiceRepository.get(this.chainType, EntityManager);
        if (await checkIfIsDeleting(em, source)) {
            logger.error(`Cannot receive requests. ${source} is deleting`);
            throw new Error(`Cannot receive requests. ${source} is deleting`);
        }
        await setAccountIsDeleting(em, source);
        const ent = await createInitialTransactionEntity(
            em,
            chainType,
            source,
            destination,
            null,
            feeInSatoshi,
            note,
            maxFeeInSatoshi,
            executeUntilBlock,
            executeUntilTimestamp,
        );
        return ent.id;
    }

    /**
     * @param txDbId
     * @param {string} source
     * @param {string} destination
     * @param {BN|null} amountInSatoshi - if null => empty all funds
     * @param {BN|undefined} feeInSatoshi - automatically set if undefined (in case of rbf it holds conflicting fee)
     * @param {string|undefined} note
     * @param txForReplacement
     * @returns {Object} - BTC/DOGE transaction object
     */
    async preparePaymentTransaction(
        txDbId: number,
        source: string,
        destination: string,
        amountInSatoshi: BN | null,
        feeInSatoshi?: BN,
        note?: string,
        txForReplacement?: TransactionEntity,
    ): Promise<[bitcore.Transaction, UTXOEntity[]]> {
        const isPayment = amountInSatoshi != null;
        const core = getCore(this.chainType);
        const [utxos, dbUTXOs] = await ServiceRepository.get(this.chainType, TransactionUTXOService).fetchUTXOs(source, amountInSatoshi, feeInSatoshi, getEstimatedNumberOfOutputs(amountInSatoshi, note), txForReplacement);

        if (amountInSatoshi == null) {
            feeInSatoshi = await this.transactionFeeService.getEstimateFee(utxos.length);
            amountInSatoshi = (await getAccountBalance(this.chainType, source)).sub(feeInSatoshi);
        }

        const utxosAmount = utxos.reduce((accumulator, transaction) => {
            return accumulator + transaction.satoshis;
        }, 0);

        if (amountInSatoshi.lte(getDustAmount(this.chainType))) {
            logger.warn(`Will not prepare transaction ${txDbId}, for ${source}. Amount ${amountInSatoshi.toString()} is less than dust ${getDustAmount(this.chainType).toString()}`);
            throw new LessThanDustAmountError(
                `Will not prepare transaction ${txDbId}, for ${source}. Amount ${amountInSatoshi.toString()} is less than dust ${getDustAmount(this.chainType).toString()}`,
            );
        }

        if (toBN(utxosAmount).sub(amountInSatoshi).lten(0)) {
            logger.warn(`Not enough UTXOs for creating transaction ${txDbId}; utxosAmount: ${utxosAmount.toString()}, needed amount ${amountInSatoshi.toString()}`)
            throw new NotEnoughUTXOsError(`Not enough UTXOs for creating transaction ${txDbId}; utxosAmount: ${utxosAmount.toString()}, needed amount ${amountInSatoshi.toString()}`);//TODO - do not fetch indefinitely - maybe check if fee quite high?
        }

        const tr = new core.Transaction().from(utxos.map((utxo) => new UnspentOutput(utxo))).to(destination, toNumber(amountInSatoshi));
        if (isPayment) {
            tr.change(source);
        }
        if (note) {
            tr.addData(Buffer.from(unPrefix0x(note), "hex"));
        }
        tr.enableRBF();

        if (feeInSatoshi && !txForReplacement) {
            tr.fee(toNumber(feeInSatoshi));
        }
        if (isPayment && !feeInSatoshi || txForReplacement) {
            let feeRatePerKB: BN = await this.transactionFeeService.getFeePerKB();
            logger.info(`Transaction ${txDbId} received fee of ${feeRatePerKB.toString()} satoshies per kb.`);
            if (txForReplacement && feeInSatoshi) {
                const feeToCover: BN = feeInSatoshi;
                if (txForReplacement.size && txForReplacement.fee) {
                    const minRequiredFeePerKb: BN = toBN(txForReplacement.fee.divn(txForReplacement.size).muln(1000));
                    if (feeRatePerKB.lt(minRequiredFeePerKb)) {
                        feeRatePerKB = minRequiredFeePerKb.muln(1.4);
                    }
                    const estimateFee = await this.transactionFeeService.getEstimateFee(utxos.length, 3, feeRatePerKB);
                    const newTxFee: BN = feeToCover.add(estimateFee);
                    tr.fee(toNumber(newTxFee));
                    logger.info(`Transaction ${txDbId} feeToCover ${feeToCover.toString()}, newTxFee ${newTxFee.toString()}, minRequiredFee ${minRequiredFeePerKb.toString()}, feeRatePerKB ${feeRatePerKB.toString()}`);
                }
            } else {
                tr.feePerKb(Number(feeRatePerKB));
            }
        }
        return [tr, dbUTXOs];
    }
}