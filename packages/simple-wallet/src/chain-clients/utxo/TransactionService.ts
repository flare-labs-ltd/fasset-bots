import BN from "bn.js";
import {logger} from "../../utils/logger";
import {createInitialTransactionEntity, setAccountIsDeleting,} from "../../db/dbutils";
import {EntityManager} from "@mikro-orm/core";
import {ChainType, MAX_NUM_OF_INPUT_UTXOS, MIN_RELAY_FEE_INCREASE_RBF_IN_B} from "../../utils/constants";
import {TransactionEntity} from "../../entity/transaction";
import {Transaction} from "bitcore-lib";
import {getAccountBalance, getCore, getDustAmount, getOutputSize} from "./UTXOUtils";
import {unPrefix0x} from "../../utils/utils";
import {toBN, toNumber} from "../../utils/bnutils";
import {TransactionData, TransactionUTXOService} from "./TransactionUTXOService";
import {TransactionFeeService} from "./TransactionFeeService";
import {LessThanDustAmountError, NegativeFeeError, NotEnoughUTXOsError} from "../../utils/axios-utils";
import {UTXO} from "../../interfaces/IWalletTransaction";
import {IUtxoWalletServices} from "./IUtxoWalletServices";
import {MempoolUTXO} from "../../interfaces/IBlockchainAPI";
import UnspentOutput = Transaction.UnspentOutput;

export class TransactionService {

    private readonly services: IUtxoWalletServices;
    private readonly chainType: ChainType;
    private readonly transactionFeeService: TransactionFeeService;
    private readonly rootEm: EntityManager;
    private readonly utxoService: TransactionUTXOService;

    constructor(services: IUtxoWalletServices, chainType: ChainType) {
        this.services = services;
        this.chainType = chainType;
        this.transactionFeeService = services.transactionFeeService;
        this.rootEm = services.rootEm;
        this.utxoService = services.transactionUTXOService;
    }

    async createPaymentTransaction(
        chainType: ChainType,
        source: string,
        destination: string,
        amountInSatoshi: BN | null,
        feeInSatoshi?: BN,
        note?: string,
        maxFee?: BN,
        executeUntilBlock?: number,
        executeUntilTimestamp?: BN,
        feeSource?: string,
        maxPaymentForFeeSource?: BN,
        isFreeUnderlying?: boolean
    ): Promise<number> {
        /* istanbul ignore next */
        logger.info(
            `Received request to create transaction from ${source} to ${destination} with amount ${amountInSatoshi?.toString()}${note ? ` and reference ${note}` : ""}${executeUntilBlock ? `, with block limit ${executeUntilBlock}` : ""}${executeUntilTimestamp ? `, with time limit ${executeUntilTimestamp.toString()}` : ""}${maxFee ? `, maxFee ${maxFee}` : ""}${feeSource ? `, feeSource ${feeSource}` : ""}${maxPaymentForFeeSource ? `, maxPaymentForFeeSource ${maxPaymentForFeeSource}` : ""}`);
        const ent = await createInitialTransactionEntity(
            this.rootEm,
            chainType,
            source,
            destination,
            amountInSatoshi,
            feeInSatoshi,
            note,
            maxFee,
            executeUntilBlock,
            executeUntilTimestamp,
            undefined,
            feeSource,
            maxPaymentForFeeSource,
            isFreeUnderlying
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
        logger.info(
            `Received request to delete account from ${source} to ${destination} ${note ? ` and reference ${note}` : ""}${executeUntilBlock ? `, with block limit ${executeUntilBlock}` : ""}${executeUntilTimestamp ? `, with time limit ${executeUntilTimestamp.toString()}` : ""}`
        );
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
     * @param freeUnderlying
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
        feeSource?: string,
        freeUnderlying?: boolean
    ): Promise<[Transaction, MempoolUTXO[]]> {
        if (amountInSatoshi?.lte(getDustAmount(this.chainType))) {
            logger.warn(`Will not prepare transaction ${txDbId}, for ${source}. Amount ${amountInSatoshi.toString()} is less than dust ${getDustAmount(this.chainType).toString()}`);
            throw new LessThanDustAmountError(
                `Will not prepare transaction ${txDbId}, for ${source}. Amount ${amountInSatoshi.toString()} is less than dust ${getDustAmount(this.chainType).toString()}`,
            );
        }

        if (feeSource && amountInSatoshi) {
            return this.preparePaymentTransactionWithAdditionalFeeWallet(txDbId, source, feeSource, destination, amountInSatoshi, feeInSatoshi, note, txForReplacement);
        } else if (freeUnderlying) {
            return this.prepareFreeUnderlyingPaymentTransactionWithSingleWallet(txDbId, source, destination, amountInSatoshi!, feeInSatoshi, note, txForReplacement)
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
    ): Promise<[Transaction, MempoolUTXO[]]> {
        const isPayment = amountInSatoshi != null;
        const txData = {
            source: source,
            destination: destination,
            amount: amountInSatoshi,
            fee: feeInSatoshi,
            useChange: isPayment,
            note: note,
        } as TransactionData;
        let utxos: MempoolUTXO[];
        const feePerKB = await this.transactionFeeService.getFeePerKB();

        if (isPayment && !feeInSatoshi) {
            txData.feePerKB = feePerKB;
        }
        if (amountInSatoshi == null) {
            utxos = await this.utxoService.filteredAndSortedMempoolUTXOs(source);

            // In case that account has large number of UTXOs the "delete account transactions" is created as a sequence of smaller transactions
            const useMultipleTransactions = utxos.length > MAX_NUM_OF_INPUT_UTXOS;
            if (useMultipleTransactions) {
                utxos = utxos.slice(0, MAX_NUM_OF_INPUT_UTXOS);
            }

            // Fee should be reduced for 1 one output, this is because the transaction above is calculated using change, because bitcore otherwise uses everything as fee
            const bitcoreTx = await this.createBitcoreTransaction(source, destination, new BN(0), undefined, feePerKB, utxos, true, note);
            feeInSatoshi = toBN(bitcoreTx.getFee()).sub(feePerKB.muln(getOutputSize(this.chainType)).divn(1000));
            if (feeInSatoshi.ltn(0)) {
                logger.warn(`Will not prepare transaction ${txDbId}, for ${source}. Negative fee ${feeInSatoshi.toString()}`);
                throw new NegativeFeeError(
                    `Will not prepare transaction ${txDbId}, for ${source}. Amount ${feeInSatoshi.toString()}`,
                );
            }
            if (useMultipleTransactions) {
                amountInSatoshi = utxos.reduce((acc: BN, t: MempoolUTXO) => acc.add(t.value), new BN(0)).sub(feeInSatoshi);
                txData.amount = amountInSatoshi;
            } else {
                const balance = await getAccountBalance(this.services.blockchainAPI, source);
                amountInSatoshi = balance.sub(feeInSatoshi);
                txData.amount = amountInSatoshi;
            }
        } else {
            utxos = await this.utxoService.fetchUTXOs(txData, txForReplacement?.raw);
        }

        this.transactionChecks(txDbId, txData, utxos);
        const tr = await this.createBitcoreTransaction(source, destination, amountInSatoshi, feeInSatoshi, feePerKB, utxos, isPayment, note);

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
        txForReplacement?: TransactionEntity,
        freeUnderlying?: boolean
    ): Promise<[Transaction, MempoolUTXO[]]> {
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
        const utxosForAmount = await this.utxoService.fetchUTXOs(txDataForAmount, txForReplacement?.raw);
        this.transactionChecks(txDbId, txDataForAmount, utxosForAmount);

        const baseTransaction = await this.createBitcoreTransaction(source, destination, amountInSatoshi, feeInSatoshi, feePerKB, utxosForAmount, true, note);

        // If fee is lower than dust ignore the fee source
        if (!toBN(baseTransaction.getFee()).gt(getDustAmount(this.chainType))) {
            return this.preparePaymentTransactionWithSingleWallet(txDbId, source, destination, amountInSatoshi, feeInSatoshi, note, txForReplacement);
        }

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
        let utxos: MempoolUTXO[];
        // Not enough funds on wallet for handling fees - we use additional UTXOs from main wallet
        if (utxosForFee.length === 0) {
            utxosForFee = await this.utxoService.filteredAndSortedMempoolUTXOs(feeSource);
            const txData = {
                source: source,
                destination: destination,
                amount: amountInSatoshi,
                fee: feeInSatoshi,
                feePerKB: feePerKB,
                useChange: true,
                note: note,
            } as TransactionData;

            utxos = await this.utxoService.fetchUTXOs(txData);
        } else {
            utxos = utxosForAmount.concat(utxosForFee);
        }

        const utxosForFeeAmount = utxosForFee.reduce((accumulator, utxo) => accumulator.add(utxo.value), new BN(0));

        let tr;
        if (freeUnderlying && !feeInSatoshi) {
            const trForFee = await this.createBitcoreTransaction(source, destination, amountInSatoshi, undefined, feePerKB, utxos, true, note);
            const amount = utxosForFeeAmount.gtn(trForFee.getFee()) ? amountInSatoshi : amountInSatoshi.subn(trForFee.getFee() - utxosForFeeAmount.toNumber())
            tr = await this.createBitcoreTransaction(source, destination, amount, toBN(trForFee.getFee()), undefined, utxos, true, note);
        } else {
            tr = await this.createBitcoreTransaction(source, destination, amountInSatoshi, feeInSatoshi, feePerKB, utxos, true, note);
        }

        if (!feeInSatoshi || txForReplacement) {
            await this.correctFee(txDbId, tr, txForReplacement, feeInSatoshi, utxos);
        }

        if (freeUnderlying && utxosForFeeAmount.ltn(tr.getFee())) {
            tr = await this.correctFeeForFreeUnderyling(tr, utxos, utxosForFeeAmount, source, destination, amountInSatoshi, note);
        }

        const correctedFee = tr.getFee() + (feeInSatoshi ? 0 : feePerKB.muln(31).divn(1000).toNumber()); // Fee should be higher since we have additional output (+31vB)!
        if (utxosForFeeAmount.subn(correctedFee).gt(getDustAmount(this.chainType))) {
            const remainder = utxosForFeeAmount.subn(correctedFee);
            tr = await this.createBitcoreTransaction(source, destination, amountInSatoshi, toBN(correctedFee), undefined, utxos, true, note, feeSource, remainder);
        }

        return [tr, utxos];
    }

    async prepareFreeUnderlyingPaymentTransactionWithSingleWallet(
        txDbId: number,
        source: string,
        destination: string,
        amountInSatoshi: BN,
        feeInSatoshi?: BN,
        note?: string,
        txForReplacement?: TransactionEntity,
    ): Promise<[Transaction, MempoolUTXO[]]> {
        const txData = {
            source: source,
            destination: destination,
            amount: amountInSatoshi,
            fee: feeInSatoshi ?? toBN(0),
            useChange: true,
            note: note,
        } as TransactionData;

        const utxos = await this.utxoService.fetchUTXOs(txData, txForReplacement?.raw);
        let tr;

        if (feeInSatoshi) {
            this.transactionChecks(txDbId, txData, utxos);
            tr = await this.createBitcoreTransaction(source, destination, amountInSatoshi, feeInSatoshi, undefined, utxos, true, note);
        } else {
            const feePerKB = await this.transactionFeeService.getFeePerKB();
            const trForFee = await this.createBitcoreTransaction(source, destination, amountInSatoshi, undefined, feePerKB, utxos, true, note);
            tr = await this.createBitcoreTransaction(source, destination, amountInSatoshi.subn(trForFee.getFee()), toBN(trForFee.getFee()), undefined, utxos, true, note);
        }

        if (!feeInSatoshi || txForReplacement) {
            await this.correctFee(txDbId, tr, txForReplacement, feeInSatoshi, utxos);
        }

        tr = await this.correctFeeForFreeUnderyling(tr, utxos, toBN(0), source, destination, amountInSatoshi, note);

        return [tr, utxos];
    }

    private async correctFeeForFreeUnderyling(tr: Transaction, utxos: MempoolUTXO[], utxosForFeeAmount: BN, source: string, destination: string, amountInSatoshi: BN, note?: string) {
        const inputAmount = toBN(tr.inputs.reduce((acc, t) => acc + t.output!.satoshis, 0));
        const outputAmount = toBN(tr.outputs.reduce((acc, t) => acc + t.satoshis, 0));
        const fee = toBN(tr.getFee()).sub(utxosForFeeAmount);

        if (inputAmount.sub(fee).sub(outputAmount).ltn(0)) {
            tr = await this.createBitcoreTransaction(source, destination, amountInSatoshi.sub(fee), fee, undefined, utxos, true, note);
        }

        return tr;
    }

    private async correctFee(txDbId: number, tr: Transaction, txForReplacement: TransactionEntity | undefined, feeInSatoshi: BN | undefined, allUTXOs: MempoolUTXO[]) {
        let feeRatePerKB: BN = await this.transactionFeeService.getFeePerKB();
        logger.info(`Transaction ${txDbId} received fee of ${feeRatePerKB.toString()} satoshies per kb.`);
        if (txForReplacement) {
            if (feeInSatoshi != null) {
                const feeToCover: BN = feeInSatoshi;
                if (txForReplacement.size && txForReplacement.fee) {
                    const feePerKBPaidInOriginal = toBN(txForReplacement.fee.muln(1000)).divn(txForReplacement.size);
                    const minRequiredFeePerKb: BN = feePerKBPaidInOriginal.addn(MIN_RELAY_FEE_INCREASE_RBF_IN_B * this.transactionFeeService.feeIncrease);
                    if (feeRatePerKB.lt(minRequiredFeePerKb)) {
                        feeRatePerKB = minRequiredFeePerKb;
                    }
                    const estimateFee = await this.transactionFeeService.getEstimateFee(allUTXOs.length, txForReplacement.feeSource ? 4 : 3, feeRatePerKB);
                    const newTxFee: BN = feeToCover.add(estimateFee);
                    tr.fee(toNumber(newTxFee));
                    logger.info(`Transaction ${txDbId} feeToCover ${feeToCover.toString()}, newTxFee ${newTxFee.toString()} and minRequiredFee ${minRequiredFeePerKb.toString()}.`);
                }
            }
        } else {
            tr.feePerKb(Number(feeRatePerKB));
        }
    }

    private transactionChecks(txDbId: number, txData: TransactionData, utxos: MempoolUTXO[]): void {
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

    async createBitcoreTransaction(
        source: string,
        destination: string,
        amountInSatoshi: BN,
        fee: BN | undefined,
        feePerKB: BN | undefined,
        utxos: MempoolUTXO[],
        useChange: boolean,
        note?: string,
        feeSource?: string,
        feeSourceRemainder?: BN,
    ): Promise<Transaction> {
        const updatedUtxos = await this.utxoService.handleMissingUTXOScripts(utxos, source);
        const txUTXOs = updatedUtxos.map((utxo) => ({
            txid: utxo.transactionHash,
            outputIndex: utxo.position,
            scriptPubKey: utxo.script,
            satoshis: utxo.value.toNumber(),
        }) as UTXO);

        const core = getCore(this.chainType);
        const tr = new core.Transaction().from(txUTXOs.map((utxo) => new UnspentOutput(utxo))).to(destination, toNumber(amountInSatoshi));
        if (feeSourceRemainder && feeSource) {
            tr.to(feeSource, feeSourceRemainder.toNumber());
        }

        if (note) {
            tr.addData(Buffer.from(unPrefix0x(note), "hex"));
        }
        tr.enableRBF();

        /* istanbul ignore else */
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
