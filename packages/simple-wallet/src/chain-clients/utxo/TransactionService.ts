import BN from "bn.js";
import { logger } from "../../utils/logger";
import {
    checkIfIsDeleting,
    createInitialTransactionEntity,
    fetchUnspentUTXOs,
    setAccountIsDeleting,
} from "../../db/dbutils";
import { ServiceRepository } from "../../ServiceRepository";
import { EntityManager, IDatabaseDriver } from "@mikro-orm/core";
import { ChainType } from "../../utils/constants";
import { TransactionEntity } from "../../entity/transaction";
import { UTXOEntity } from "../../entity/utxo";
import { Transaction } from "bitcore-lib";
import { getAccountBalance, getCore, getDustAmount, getOutputSize } from "./UTXOUtils";
import { unPrefix0x } from "../../utils/utils";
import { toBN, toNumber } from "../../utils/bnutils";
import { TransactionData, TransactionUTXOService } from "./TransactionUTXOService";
import { TransactionFeeService } from "./TransactionFeeService";
import { LessThanDustAmountError, NegativeFeeError, NotEnoughUTXOsError } from "../../utils/axios-error-utils";
import { UTXO } from "../../interfaces/IWalletTransaction";
import UnspentOutput = Transaction.UnspentOutput;

export class TransactionService {

    private readonly chainType: ChainType;
    private readonly transactionFeeService: TransactionFeeService;
    private readonly rootEm: EntityManager;
    private readonly utxoService: TransactionUTXOService;

    constructor(chainType: ChainType) {
        this.chainType = chainType;
        this.transactionFeeService = ServiceRepository.get(this.chainType, TransactionFeeService);
        this.rootEm = ServiceRepository.get(this.chainType, EntityManager<IDatabaseDriver>);
        this.utxoService = ServiceRepository.get(this.chainType, TransactionUTXOService);
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
        feeSource?: string,
    ): Promise<number> {
        /* istanbul ignore next */
        logger.info(`Received request to create transaction from ${source} to ${destination} with amount ${amountInSatoshi?.toString()} and reference ${note}, with limits ${executeUntilBlock} and ${executeUntilTimestamp?.toString()}`);
        /* istanbul ignore if */
        if (await checkIfIsDeleting(this.rootEm, source)) {
            logger.error(`Cannot receive requests. ${source} is deleting`);
            throw new Error(`Cannot receive requests. ${source} is deleting`);
        }
        const ent = await createInitialTransactionEntity(
            this.rootEm,
            chainType,
            source,
            destination,
            amountInSatoshi,
            feeInSatoshi,
            note,
            maxFeeInSatoshi,
            executeUntilBlock,
            executeUntilTimestamp,
            undefined,
            feeSource
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
        /* istanbul ignore if */
        if (await checkIfIsDeleting(this.rootEm, source)) {
            logger.error(`Cannot receive requests. ${source} is deleting`);
            throw new Error(`Cannot receive requests. ${source} is deleting`);
        }
        await setAccountIsDeleting(this.rootEm, source);
        const ent = await createInitialTransactionEntity(
            this.rootEm,
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
     * @param feeSource - source of the wallet for paying fees
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
        feeSource?: string
    ): Promise<[Transaction, UTXOEntity[]]> {
        if (feeSource && amountInSatoshi) {
            return this.preparePaymentTransactionWithAdditionalFeeWallet(txDbId, source, feeSource, destination, amountInSatoshi, feeInSatoshi, note, txForReplacement);
        } else {
            return this.preparePaymentTransactionWithSingleWallet(txDbId, source, destination, amountInSatoshi, feeInSatoshi, note, txForReplacement)
        }
    }

    async preparePaymentTransactionWithSingleWallet(
        txDbId: number,
        source: string,
        destination: string,
        amountInSatoshi: BN | null,
        feeInSatoshi?: BN,
        note?: string,
        txForReplacement?: TransactionEntity,
    ): Promise<[Transaction, UTXOEntity[]]> {
        const isPayment = amountInSatoshi != null;
        const txData = {
            source: source,
            destination: destination,
            amount: amountInSatoshi,
            fee: feeInSatoshi,
            useChange: isPayment,
            note: note,
        } as TransactionData;
        const utxoService = ServiceRepository.get(this.chainType, TransactionUTXOService);
        let utxos;
        const feePerKB = await this.transactionFeeService.getFeePerKB();

        if (isPayment && !feeInSatoshi) {
            txData.feePerKB = feePerKB;
        }
        if (amountInSatoshi == null) {
            utxos = await fetchUnspentUTXOs(this.rootEm, source);
            // Fee should be reduced for 1 one output, this is because the transaction above is calculated using change, because bitcore otherwise uses everything as fee
            const bitcoreTx = this.createBitcoreTransaction(source, destination, new BN(0), undefined, feePerKB, utxos, true, note);
            feeInSatoshi = toBN(bitcoreTx.getFee()).sub(feePerKB.muln(getOutputSize(this.chainType)).divn(1000));
            if (feeInSatoshi.ltn(0)) {
                logger.warn(`Will not prepare transaction ${txDbId}, for ${source}. Negative fee ${feeInSatoshi.toString()}`);
                throw new NegativeFeeError(
                    `Will not prepare transaction ${txDbId}, for ${source}. Amount ${feeInSatoshi.toString()}`,
                );
            }
            const balance = await getAccountBalance(this.chainType, source);
            amountInSatoshi = balance.sub(feeInSatoshi);
        } else {
            utxos = await utxoService.fetchUTXOs(txData, txForReplacement?.utxos.getItems());
        }

        this.transactionChecks(txDbId, txData, utxos);
        const tr = this.createBitcoreTransaction(source, destination, amountInSatoshi, feeInSatoshi, feePerKB, utxos, isPayment, note);

        if (feeInSatoshi && !txForReplacement) {
            tr.fee(toNumber(feeInSatoshi));
        }

        if (isPayment && !feeInSatoshi || txForReplacement) {
            await this.correctFee(txDbId, tr, txForReplacement, feeInSatoshi, utxos);
        }

        return [tr, utxos];
    }

    async preparePaymentTransactionWithAdditionalFeeWallet(
        txDbId: number,
        source: string,
        feeSource: string,
        destination: string,
        amountInSatoshi: BN,
        feeInSatoshi?: BN,
        note?: string,
        txForReplacement?: TransactionEntity
    ): Promise<[Transaction, UTXOEntity[]]> {
        const feePerKB = feeInSatoshi ?? await this.transactionFeeService.getFeePerKB();
        const txDataForAmount = {
            source: source,
            destination: destination,
            amount: amountInSatoshi,
            fee: toBN(0),
            useChange: true,
            note: note,
        } as TransactionData;

        /* istanbul ignore next: skip for the ?.utxos ... */
        const utxosForAmount = await this.utxoService.fetchUTXOs(txDataForAmount, txForReplacement?.utxos.getItems());
        this.transactionChecks(txDbId, txDataForAmount, utxosForAmount);

        const baseTransaction = this.createBitcoreTransaction(source, destination, amountInSatoshi, feeInSatoshi, feePerKB, utxosForAmount, true, note);
        const txDataForFee = {
            source: feeSource,
            destination: destination,
            amount: toBN(baseTransaction.getFee()),
            fee: toBN(0),
            feePerKB: feePerKB,
            useChange: false,
            note: note,
        } as TransactionData;

        let utxosForFee = await this.utxoService.fetchUTXOs(txDataForFee);
        let utxos = []
        // Not enough funds on wallet for handling fees - we use additional UTXOs from main wallet
        if (utxosForFee.length === 0) {
            utxosForFee = await fetchUnspentUTXOs(this.rootEm, feeSource);
            const txData = {
                source: source,
                destination: destination,
                amount: amountInSatoshi,
                fee: feeInSatoshi,
                feePerKB: feePerKB,
                useChange: true,
                note: note,
            } as TransactionData;

            utxos = await this.utxoService.fetchUTXOs(txData, utxosForFee);
        } else {
            utxos = utxosForAmount.concat(utxosForFee);
        }

        const tr = this.createBitcoreTransaction(source, destination, amountInSatoshi, feeInSatoshi, feePerKB, utxos, true, note);
        if (!feeInSatoshi || txForReplacement) {
            await this.correctFee(txDbId, tr, txForReplacement, feeInSatoshi, utxos);
        }

        const utxosForFeeAmount = utxosForFee.reduce((accumulator, utxo) => accumulator.add(utxo.value), new BN(0));
        const correctedFee = tr.getFee() + feePerKB.muln(31).divn(1000).toNumber(); // Fee should be higher since we have additional output (+31vB)!
        if (utxosForFeeAmount.subn(correctedFee).gt(getDustAmount(this.chainType))) {
            const remainder = utxosForFeeAmount.subn(correctedFee).toNumber();
            tr.to(feeSource, remainder);
            tr.change(source);
        }

        return [tr, utxos];
    }

    private async correctFee(txDbId: number, tr: Transaction, txForReplacement: TransactionEntity | undefined, feeInSatoshi: BN | undefined, allUTXOs: UTXOEntity[]) {
        let feeRatePerKB: BN = await this.transactionFeeService.getFeePerKB();
        logger.info(`Transaction ${txDbId} received fee of ${feeRatePerKB.toString()} satoshies per kb.`);
        if (txForReplacement && feeInSatoshi) {
            const feeToCover: BN = feeInSatoshi;
            if (txForReplacement.size && txForReplacement.fee) {
                const minRequiredFeePerKb: BN = toBN(txForReplacement.fee.divn(txForReplacement.size).muln(1000)).muln(this.transactionFeeService.feeIncrease);
                if (feeRatePerKB.lt(minRequiredFeePerKb)) {
                    feeRatePerKB = minRequiredFeePerKb;
                }
                const estimateFee = await this.transactionFeeService.getEstimateFee(allUTXOs.length, 4, feeRatePerKB);
                const newTxFee: BN = feeToCover.add(estimateFee);
                tr.fee(toNumber(newTxFee));
                logger.info(`Transaction ${txDbId} feeToCover ${feeToCover.toString()}, newTxFee ${newTxFee.toString()}, minRequiredFee ${minRequiredFeePerKb.toString()}, feeRatePerKB ${feeRatePerKB.toString()}`);
            }
        } else {
            tr.feePerKb(Number(feeRatePerKB));
        }
    }

    private transactionChecks( txDbId: number, txData: TransactionData, utxos: UTXOEntity[]) {
        const utxosValue = utxos.reduce((accumulator, utxo) => accumulator.add(utxo.value), new BN(0));
        if (utxos.length === 0 || utxosValue.lt(txData.amount.add(txData.fee ?? new BN(0)))) {
            logger.warn(`Not enough UTXOs for creating transaction ${txDbId}; utxosAmount: ${utxosValue.toString()}, needed amount ${txData.amount.toString()}`);
            throw new NotEnoughUTXOsError(`Not enough UTXOs for creating transaction ${txDbId}; utxosAmount: ${utxosValue.toString()}, needed amount ${txData.amount.toString()}`);
        }

        if (txData.amount.lte(getDustAmount(this.chainType))) {
            logger.warn(`Will not prepare transaction ${txDbId}, for ${txData.source}. Amount ${txData.amount.toString()} is less than dust ${getDustAmount(this.chainType).toString()}`);
            throw new LessThanDustAmountError(
                `Will not prepare transaction ${txDbId}, for ${txData.source}. Amount ${txData.amount.toString()} is less than dust ${getDustAmount(this.chainType).toString()}`,
            );
        }
    }

    createBitcoreTransaction(
        source: string,
        destination: string,
        amountInSatoshi: BN,
        fee: BN | undefined,
        feePerKB: BN | undefined,
        utxos: UTXOEntity[],
        useChange: boolean,
        note?: string,
    ) {
        const txUTXOs = utxos.map((utxo) => ({
            txid: utxo.mintTransactionHash,
            outputIndex: utxo.position,
            scriptPubKey: utxo.script,
            satoshis: utxo.value.toNumber(),
        }) as UTXO);

        const core = getCore(this.chainType);
        const tr = new core.Transaction().from(txUTXOs.map((utxo) => new UnspentOutput(utxo))).to(destination, toNumber(amountInSatoshi));

        if (note) {
            tr.addData(Buffer.from(unPrefix0x(note), "hex"));
        }
        tr.enableRBF();

        if (fee) {
            tr.fee(toNumber(fee));
        } else if (feePerKB) {
            tr.feePerKb(feePerKB.toNumber());
        }

        if (useChange) {
            tr.change(source);
        }

        return tr;
    }
}