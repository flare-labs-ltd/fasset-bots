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
import { getDefaultFeePerKB, unPrefix0x } from "../../utils/utils";
import { InvalidFeeError, LessThanDustAmountError, NotEnoughUTXOsError } from "../../utils/errors";
import UnspentOutput = Transaction.UnspentOutput;
import { toBN, toNumber } from "../../utils/bnutils";
import { TransactionUTXOService } from "./TransactionUTXOService";
import { TransactionFeeService } from "./TransactionFeeService";

export class TransactionService implements IService {

    private readonly chainType: ChainType;
    private readonly transactionFeeService: TransactionFeeService;

    constructor(chainType: ChainType) {
        this.chainType = chainType;
        this.transactionFeeService = ServiceRepository.get(TransactionFeeService);
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
        executeUntilTimestamp?: number,
    ): Promise<number> {
        logger.info(`Received request to create transaction from ${source} to ${destination} with amount ${amountInSatoshi} and reference ${note}, with limits ${executeUntilBlock} and ${executeUntilTimestamp}`);
        const em = ServiceRepository.get(EntityManager);
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
        executeUntilTimestamp?: number,
    ): Promise<number> {
        logger.info(`Received request to delete account from ${source} to ${destination} with reference ${note}`);
        const em = ServiceRepository.get(EntityManager);
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
     * @param {BN|undefined} feeInSatoshi - automatically set if undefined
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
        const [utxos, dbUTXOs] = await ServiceRepository.get(TransactionUTXOService).fetchUTXOs(source, amountInSatoshi, feeInSatoshi, getEstimatedNumberOfOutputs(amountInSatoshi, note), txForReplacement);

        if (amountInSatoshi == null) {
            feeInSatoshi = await this.transactionFeeService.getEstimateFee(utxos.length);
            amountInSatoshi = (await getAccountBalance(source)).sub(feeInSatoshi);
        }

        const utxosAmount = utxos.reduce((accumulator, transaction) => {
            return accumulator + transaction.satoshis;
        }, 0);

        if (amountInSatoshi.lte(getDustAmount(this.chainType))) {
            throw new LessThanDustAmountError(
                `Will not prepare transaction ${txDbId}, for ${source}. Amount ${amountInSatoshi.toString()} is less than dust ${getDustAmount(this.chainType).toString()}`,
            );
        }

        if (toBN(utxosAmount).sub(amountInSatoshi).lten(0)) {
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
        if (feeInSatoshi) {
            const bitcoreEstFee = toBN(tr.getFee());
            if (this.transactionFeeService.hasTooHighOrLowFee(feeInSatoshi, bitcoreEstFee)) {
                const estFee = await this.transactionFeeService.getEstimateFee(tr.inputs.length, tr.outputs.length);
                const correctFee = this.transactionFeeService.hasTooHighOrLowFee(estFee, bitcoreEstFee) ? toBN(bitcoreEstFee) : estFee;
                throw new InvalidFeeError(
                    `Transaction ${txDbId}: Provided fee ${feeInSatoshi.toNumber()} fails bitcore serialization checks! bitcoreEstFee: ${bitcoreEstFee}, estFee: ${estFee.toNumber()}`,
                    correctFee,
                );
            }
            // https://github.com/bitcoin/bitcoin/blob/55d663cb15151773cd043fc9535d6245f8ba6c99/doc/policy/mempool-replacements.md?plain=1#L37
            if (txForReplacement) {
                const totalFee = await this.transactionFeeService.calculateTotalFeeOfTxAndDescendants(ServiceRepository.get(EntityManager), txForReplacement);
                const relayFee = bitcoreEstFee.div(getDefaultFeePerKB(this.chainType)).muln(1000);

                if (feeInSatoshi.sub(totalFee).lt(relayFee)) {
                    // Set the new fee to (sum of all descendant fees + size of replacement tx * relayFee) * feeIncrease
                    const correctFee = totalFee.add(relayFee.muln(this.transactionFeeService.relayFeePerB)).muln(this.transactionFeeService.feeIncrease); // TODO: Is this a good fee?
                    throw new InvalidFeeError(
                        `Transaction ${txDbId}: Additional fee ${feeInSatoshi.toNumber()} for replacement tx is lower than relay fee`,
                        correctFee,
                    );
                }
            }
            tr.fee(toNumber(feeInSatoshi));
        }
        if (isPayment && !feeInSatoshi) {
            const feeRatePerKB = await this.transactionFeeService.getFeePerKB();
            logger.info(`Transaction ${txDbId} received fee of ${feeRatePerKB.toString()} satoshies per kb.`);
            tr.feePerKb(Number(feeRatePerKB));
        }
        return [tr, dbUTXOs];
    }
}