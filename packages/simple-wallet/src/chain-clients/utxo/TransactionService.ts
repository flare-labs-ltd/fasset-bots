import BN from "bn.js";
import {logger} from "../../utils/logger";
import {createInitialTransactionEntity, setAccountIsDeleting,} from "../../db/dbutils";
import {EntityManager} from "@mikro-orm/core";
import {
    ChainType,
    MAX_NUM_OF_INPUT_UTXOS,
} from "../../utils/constants";
import {TransactionEntity} from "../../entity/transaction";
import {Transaction} from "bitcore-lib";
import { getAccountBalance, getCore, getDustAmount, getOutputSize, getRelayFeePerKB } from "./UTXOUtils";
import { estimateTxSize, maxBN, unPrefix0x } from "../../utils/utils";
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
        isFreeUnderlying?: boolean,
        minFeePerKB?: BN
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
            isFreeUnderlying,
            minFeePerKB
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
     * @param minFeePerKB
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
        freeUnderlying?: boolean,
        minFeePerKB?: BN
    ): Promise<[Transaction, MempoolUTXO[]]> {
        if (amountInSatoshi?.lte(getDustAmount(this.chainType))) {
            logger.warn(`Will not prepare transaction ${txDbId}, for ${source}. Amount ${amountInSatoshi.toString()} is less than dust ${getDustAmount(this.chainType).toString()}`);
            throw new LessThanDustAmountError(
                `Will not prepare transaction ${txDbId}, for ${source}. Amount ${amountInSatoshi.toString()} is less than dust ${getDustAmount(this.chainType).toString()}`,
            );
        }

        const feePerKBFromFeeService = await this.transactionFeeService.getFeePerKB();
        const feePerKB = maxBN(feePerKBFromFeeService, minFeePerKB ?? toBN(0));
        let usingSuggestedFee = false;
        if (minFeePerKB && minFeePerKB.gtn(0)) {
            logger.info(`Transaction ${txDbId} received ${feePerKB.toString()} feePerKb; feePerKBFromFeeService is ${feePerKBFromFeeService.toString()}, minFeePerKB is ${minFeePerKB.toString()}`)
            if (feePerKB.eq(feePerKBFromFeeService) && !feePerKBFromFeeService.eq(minFeePerKB)) {
                usingSuggestedFee = true;
            }
        }

        if (feeSource && amountInSatoshi && !freeUnderlying) {
            // TODO - if usingSuggestedFee === true and maxFee is exceeded => us maxFee as fee for tx
            return this.preparePaymentTransactionWithAdditionalFeeWallet(txDbId, source, feeSource, destination, amountInSatoshi, feePerKB, feeInSatoshi, note, txForReplacement);
        } else if (freeUnderlying) {
            return this.prepareFreeUnderlyingPaymentTransactionWithSingleWallet(txDbId, source, destination, amountInSatoshi!, feePerKB, feeInSatoshi, note, txForReplacement);
        } else {
            // TODO - if usingSuggestedFee === true and maxFee is exceeded => us maxFee as fee for tx
            return this.preparePaymentTransactionWithSingleWallet(txDbId, source, destination, amountInSatoshi, feePerKB, feeInSatoshi, note, txForReplacement);
        }
    }

    async preparePaymentTransactionWithSingleWallet(
        txDbId: number,
        source: string,
        destination: string,
        amountInSatoshi: BN | null,
        feePerKB: BN,
        feeInSatoshi?: BN,
        note?: string,
        txForReplacement?: TransactionEntity
    ): Promise<[Transaction, MempoolUTXO[]]> {
        const isPayment = amountInSatoshi != null;

        const txData = {
            source: source,
            destination: destination,
            amount: amountInSatoshi,
            fee: feeInSatoshi,
            useChange: isPayment,
            note: note,
            replacementFor: txForReplacement
        } as TransactionData;
        let utxos: MempoolUTXO[];

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
        await this.correctFeeForRBF(txDbId, tr, txForReplacement);

        return [tr, utxos];
    }

    async preparePaymentTransactionWithAdditionalFeeWallet(
        txDbId: number,
        source: string,
        feeSource: string,
        destination: string,
        amountInSatoshi: BN,
        feePerKB: BN,
        feeInSatoshi?: BN,
        note?: string,
        txForReplacement?: TransactionEntity,
    ): Promise<[Transaction, MempoolUTXO[]]> {

        const txDataForAmount = {
            source: source,
            destination: destination,
            amount: amountInSatoshi,
            fee: toBN(0),
            useChange: true,
            note: note,
            replacementFor: txForReplacement
        } as TransactionData;

        /* istanbul ignore next: skip for the ?.utxos ... */
        const utxosForAmount = await this.utxoService.fetchUTXOs(txDataForAmount, txForReplacement?.raw);
        this.transactionChecks(txDbId, txDataForAmount, utxosForAmount);

        const baseTransaction = await this.createBitcoreTransaction(source, destination, amountInSatoshi, feeInSatoshi, feePerKB, utxosForAmount, true, note);

        // If fee is lower than dust ignore the fee source
        if (!toBN(baseTransaction.getFee()).gt(getDustAmount(this.chainType))) {
            return this.preparePaymentTransactionWithSingleWallet(txDbId, source, destination, amountInSatoshi, feePerKB, feeInSatoshi, note, txForReplacement);
        }

        const txDataForFee = {
            source: feeSource,
            destination: destination,
            amount: toBN(baseTransaction.getFee()),
            fee: toBN(0),
            feePerKB: feePerKB,
            useChange: false,
            note: note,
            replacementFor: txForReplacement
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
                replacementFor: txForReplacement
            } as TransactionData;

            utxos = await this.utxoService.fetchUTXOs(txData);
            utxosForFee = []; // ignore utxos for fee
        } else {
            utxos = utxosForAmount.concat(utxosForFee);
        }

        const utxosForFeeAmount = utxosForFee.reduce((accumulator, utxo) => accumulator.add(utxo.value), new BN(0));

        let tr = await this.createBitcoreTransaction(source, destination, amountInSatoshi, feeInSatoshi, feePerKB, utxos, true, note);

        await this.correctFeeForRBF(txDbId, tr, txForReplacement);
        const correctedFee = toBN(tr.getFee()).add(feeInSatoshi ? toBN(0) : feePerKB.muln(getOutputSize(this.chainType)).divn(1000)); // Fee should be higher since we have additional output (+31vB)!
        if (utxosForFeeAmount.sub(correctedFee).gt(getDustAmount(this.chainType))) {
            const remainder = utxosForFeeAmount.sub(correctedFee);
            tr = await this.createBitcoreTransaction(source, destination, amountInSatoshi, correctedFee, undefined, utxos, true, note, feeSource, remainder);
        }

        return [tr, utxos];
    }

    async prepareFreeUnderlyingPaymentTransactionWithSingleWallet(
        txDbId: number,
        source: string,
        destination: string,
        amountInSatoshi: BN,
        feePerKB: BN,
        feeInSatoshi?: BN,
        note?: string,
        txForReplacement?: TransactionEntity,
    ): Promise<[Transaction, MempoolUTXO[]]> {
        const amount = txForReplacement ? amountInSatoshi : amountInSatoshi.sub(feeInSatoshi ?? toBN(0));
        const txData = {
            source: source,
            destination: destination,
            amount: amount,
            fee: feeInSatoshi ?? toBN(0),
            feePerKB: txForReplacement ? feePerKB : undefined,
            useChange: true,
            note: note,
            replacementFor: txForReplacement
        } as TransactionData;
        const utxos = await this.utxoService.fetchUTXOs(txData, txForReplacement?.raw);
        let tr;

        if (feeInSatoshi) {
            this.transactionChecks(txDbId, txData, utxos);
            tr = await this.createBitcoreTransaction(source, destination, amount, feeInSatoshi, undefined, utxos, true, note);
        } else {
            const trForFee = await this.createBitcoreTransaction(source, destination, amountInSatoshi, undefined, feePerKB, utxos, true, note);
            const fee = toBN(trForFee.getFee());
            tr = await this.createBitcoreTransaction(source, destination, amountInSatoshi.sub(fee), fee, undefined, utxos, true, note);
        }

        if (!txForReplacement) {
            await this.correctFeeForFreeUnderlying(tr, utxos, toBN(0), source, destination, amountInSatoshi, note);
        }

        await this.correctFeeForRBF(txDbId, tr, txForReplacement);

        return [tr, utxos];
    }

    private async correctFeeForFreeUnderlying(tr: Transaction, utxos: MempoolUTXO[], utxosForFeeAmount: BN, source: string, destination: string, amountInSatoshi: BN, note?: string) {
        const inputAmount = toBN(tr.inputs.reduce((acc, t) => acc + t.output!.satoshis, 0));
        const outputAmount = toBN(tr.outputs.reduce((acc, t) => acc + t.satoshis, 0));
        const fee = toBN(tr.getFee()).sub(utxosForFeeAmount);

        if (inputAmount.sub(fee).sub(outputAmount).ltn(0)) {
            logger.warn(``)
            await this.createBitcoreTransaction(source, destination, amountInSatoshi.sub(fee), fee, undefined, utxos, true, note);
        }
    }

    private async correctFeeForRBF(txDbId: number, tr: Transaction, txForReplacement?: TransactionEntity) {
        if (txForReplacement) {
            const currentFee = toBN(tr.getFee());
            const relayFeePerB = getRelayFeePerKB(this.chainType).muln(this.services.transactionFeeService.feeIncrease).divn(1000);
            const txSize = Math.ceil(estimateTxSize(this.chainType, tr));
            tr.fee(currentFee.add(toBN(txSize).mul(relayFeePerB)).toNumber());
            logger.info(`Increasing RBF fee for transaction ${txDbId} from ${currentFee.toNumber()} satoshi to ${tr.getFee()} satoshi; estimated transaction size is ${txSize} (${tr.inputs.length} inputs, ${tr.outputs.length} outputs)`);
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
