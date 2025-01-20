import BN, { max } from "bn.js";
import { logger } from "../../utils/logger";
import { createInitialTransactionEntity, setAccountIsDeleting, } from "../../db/dbutils";
import { EntityManager } from "@mikro-orm/core";
import { ChainType, MAX_NUM_OF_INPUT_UTXOS, } from "../../utils/constants";
import { TransactionEntity } from "../../entity/transaction";
import { Transaction } from "bitcore-lib";
import { calculateFeePerKBFromTransactionEntity, getAccountBalance, getCore, getDustAmount, getOutputSize, getRelayFeePerKB } from "./UTXOUtils";
import { unPrefix0x } from "../../utils/utils";
import { toBN, toNumber } from "../../utils/bnutils";
import { TransactionData, TransactionUTXOService } from "./TransactionUTXOService";
import { TransactionFeeService } from "./TransactionFeeService";
import { LessThanDustAmountError, MissingAmountError, NegativeFeeError, NotEnoughUTXOsError } from "../../utils/axios-utils";
import { UTXO } from "../../interfaces/IWalletTransaction";
import { IUtxoWalletServices } from "./IUtxoWalletServices";
import { MempoolUTXO } from "../../interfaces/IBlockchainAPI";
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
     * @param maxFee
     * @param maxFeeForFeeSource
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
        minFeePerKB?: BN,
        maxFee?: BN,
        maxFeeForFeeSource?: BN
    ): Promise<[Transaction, MempoolUTXO[]]> {
        // free underlying payment
        const feePerKBFromFeeService = await this.transactionFeeService.getFeePerKB();
        if (freeUnderlying && amountInSatoshi) {
            return this.prepareFreeUnderlyingPaymentTransaction(txDbId, source, destination, amountInSatoshi, feePerKBFromFeeService, feeInSatoshi, note, txForReplacement);
        } else if (freeUnderlying && amountInSatoshi === null) {
            throw new MissingAmountError (
                `Will not prepare transaction ${txDbId}, for ${source}. Amount is not defined.`,
            )
        }
        // calculate appropriate fee per KB
        const txForReplacementFeePerKB = calculateFeePerKBFromTransactionEntity(txForReplacement);
        const feePerKB = max(feePerKBFromFeeService, max(minFeePerKB ?? toBN(0), txForReplacementFeePerKB));
        let usingSuggestedFee = false;
        logger.info(`Transaction ${txDbId} received ${feePerKB.toString()} feePerKb; feePerKBFromFeeService is ${feePerKBFromFeeService.toString()}, minFeePerKB is ${minFeePerKB ? minFeePerKB.toString() : undefined}`)
        if (minFeePerKB && minFeePerKB.gtn(0)) {
            if (feePerKB.eq(minFeePerKB) && !feePerKBFromFeeService.eq(minFeePerKB)) {
                usingSuggestedFee = true;
            }
        }
        // redemption payment
        if (feeSource && amountInSatoshi && !txForReplacement) {
            return this.preparePaymentTransactionWithAdditionalFeeWallet(txDbId, source, feeSource, destination, amountInSatoshi, usingSuggestedFee, feePerKB, feeInSatoshi, maxFee, maxFeeForFeeSource, note);
        } else {
            return this.preparePaymentTransactionWithSingleWallet(txDbId, source, destination, amountInSatoshi, usingSuggestedFee, feePerKB, feeInSatoshi, maxFee, note, txForReplacement);
        }
    }

    async preparePaymentTransactionWithSingleWallet(
        txDbId: number,
        source: string,
        destination: string,
        amountInSatoshi: BN | null,
        usingSuggestedFee: boolean,
        feePerKB: BN,
        feeInSatoshi?: BN,
        maxFee?: BN,
        note?: string,
        txForReplacement?: TransactionEntity
    ): Promise<[Transaction, MempoolUTXO[]]> {
        const isPayment = amountInSatoshi != null;
        logger.info(`Preparing ${isPayment ? "payment": "delete"} ${txForReplacement ? "rbf" : ""} transaction ${txDbId}`);

        const txData = {
            source: source,
            destination: destination,
            amount: amountInSatoshi,
            fee: feeInSatoshi,
            feePerKB: feePerKB,
            useChange: isPayment,
            note: note,
            replacementFor: txForReplacement,
            maxFee: maxFee
        } as TransactionData;
        let utxos: MempoolUTXO[];

        if (amountInSatoshi == null) {
            utxos = await this.utxoService.filteredAndSortedMempoolUTXOs(source); // fetch all utxos
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
            utxos = await this.utxoService.fetchUTXOs(txData, source, txForReplacement?.raw);
        }

        this.checkIfAmountIsAllowed(txDbId, amountInSatoshi, source);
        this.checkIfEnoughUtxoToCoverAmount(txDbId, amountInSatoshi, utxos, feeInSatoshi);

        const tr = await this.createBitcoreTransaction(source, destination, amountInSatoshi, txForReplacement ? undefined : feeInSatoshi, feePerKB, utxos, isPayment, note);
        await this.correctFeeForRBF(txDbId, tr, txForReplacement);
        this.correctFeeDueToSuggestedFee(txDbId, tr, usingSuggestedFee, !!txForReplacement, maxFee); // TODO-check


        return [tr, utxos];
    }

    async preparePaymentTransactionWithAdditionalFeeWallet(
        txDbId: number,
        source: string,
        feeSource: string,
        destination: string,
        amountInSatoshi: BN,
        usingSuggestedFee: boolean,
        feePerKB: BN,
        feeInSatoshi?: BN,
        maxFee?: BN,
        maxFeeForFeeSource?: BN,
        note?: string
    ): Promise<[Transaction, MempoolUTXO[]]> {
        logger.info(`Preparing payment transaction ${txDbId} with additional wallet`);

        const txDataForAmount = {
            source: source,
            destination: destination,
            amount: amountInSatoshi,
            fee: toBN(0),
            feePerKB: feePerKB,
            useChange: true,
            note: note
        } as TransactionData;

        const utxosForAmount = await this.utxoService.fetchUTXOs(txDataForAmount, source);
        this.checkIfAmountIsAllowed(txDbId, amountInSatoshi, source);
        this.checkIfEnoughUtxoToCoverAmount(txDbId, amountInSatoshi, utxosForAmount, toBN(0));

        const baseTransaction = await this.createBitcoreTransaction(source, destination, amountInSatoshi, feeInSatoshi, feePerKB, utxosForAmount, true, note);
        // If fee is lower than dust ignore the fee source
        if (toBN(baseTransaction.getFee()).lte(getDustAmount(this.chainType))) {
            return this.preparePaymentTransactionWithSingleWallet(txDbId, source, destination, amountInSatoshi, usingSuggestedFee, feePerKB, feeInSatoshi, maxFee, note);
        }

        const txDataForFee = {
            source: feeSource,
            destination: destination,
            amount: toBN(baseTransaction.getFee()),
            fee: toBN(0),
            feePerKB: feePerKB,
            useChange: true,
            note: note
        } as TransactionData;

        let utxosForFee = await this.utxoService.fetchUTXOs(txDataForFee, feeSource);
        let utxos: MempoolUTXO[];
        // Not enough funds on wallet for handling fees - we use additional UTXOs from main wallet
        if (utxosForFee.length === 0) {
            const txData = {
                source: source,
                destination: destination,
                amount: amountInSatoshi,
                fee: feeInSatoshi,
                feePerKB: feePerKB,
                useChange: true,
                note: note
            } as TransactionData;

            utxos = await this.utxoService.fetchUTXOs(txData, source);
        } else {
            utxos = utxosForAmount.concat(utxosForFee);
        }

        const utxosForFeeAmount = utxosForFee.reduce((accumulator, utxo) => accumulator.add(utxo.value), new BN(0));
        let tr = await this.createBitcoreTransaction(source, destination, amountInSatoshi, feeInSatoshi, feePerKB, utxos, true, note);
        const correctedFee = toBN(tr.getFee()).add(feeInSatoshi ? toBN(0) : feePerKB.muln(getOutputSize(this.chainType)).divn(1000)); // Fee should be higher since we have additional output (+31vB)!
        tr.fee(correctedFee.toNumber());
        const correctedAndSuggestedFee = this.correctFeeDueToSuggestedFee(txDbId, tr, usingSuggestedFee, false, maxFeeForFeeSource);

        if (utxosForFeeAmount.sub(correctedAndSuggestedFee).gt(getDustAmount(this.chainType))) {
            const remainder = utxosForFeeAmount.sub(correctedAndSuggestedFee);
            tr = await this.createBitcoreTransaction(source, destination, amountInSatoshi, correctedAndSuggestedFee, undefined, utxos, true, note, feeSource, remainder);
        }

        return [tr, utxos];
    }

    async prepareFreeUnderlyingPaymentTransaction(
        txDbId: number,
        source: string,
        destination: string,
        amountInSatoshi: BN,
        feePerKB: BN,
        feeInSatoshi?: BN,
        note?: string,
        txForReplacement?: TransactionEntity,
    ): Promise<[Transaction, MempoolUTXO[]]> {
        logger.info(`Preparing fee underlying transaction ${txDbId}`);
        const txData = {
            source: source,
            destination: destination,
            amount: amountInSatoshi,
            fee: feeInSatoshi ?? toBN(0),
            feePerKB: feePerKB,
            useChange: true,
            note: note,
            replacementFor: txForReplacement
        } as TransactionData;
        const utxos = await this.utxoService.fetchUTXOs(txData, source, txForReplacement?.raw);

        let tr;
        if (feeInSatoshi) {
            const amountToSend = txData.amount.sub(feeInSatoshi);
            this.checkIfAmountIsAllowed(txDbId, amountToSend, source);
            this.checkIfEnoughUtxoToCoverAmount(txDbId, amountToSend, utxos, feeInSatoshi);
            tr = await this.createBitcoreTransaction(source, destination, amountToSend, feeInSatoshi, undefined, utxos, true, note);
        } else {
            const trForFee = await this.createBitcoreTransaction(source, destination, amountInSatoshi, undefined, feePerKB, utxos, true, note);
            const fee = toBN(trForFee.getFee());
            const amountToSend = txData.amount.sub(fee);
            this.checkIfAmountIsAllowed(txDbId, amountToSend, source);
            this.checkIfEnoughUtxoToCoverAmount(txDbId, amountToSend, utxos, feeInSatoshi);
            tr = await this.createBitcoreTransaction(source, destination, amountToSend, fee, undefined, utxos, true, note);
        }

        await this.correctFeeForRBF(txDbId, tr, txForReplacement);
        const feeToUse = toBN(tr.getFee())
        const amountToSend = txData.amount.sub(feeToUse);
        if (txForReplacement) {
            tr = await this.createBitcoreTransaction(source, destination, amountToSend, feeToUse, undefined, utxos, true, note);
        }
        // fail if amount less than dust or amount-fee less than dust in case of freeUnderlying
        this.checkIfAmountIsAllowed(txDbId, amountToSend, source);
        return [tr, utxos];
    }

    private async correctFeeForRBF(txDbId: number, tr: Transaction, txForReplacement?: TransactionEntity) { // tODO - check
        if (txForReplacement && txForReplacement.fee && txForReplacement.amount) {
            const fee = toBN(txForReplacement.fee);
            if (toBN(tr.getFee()).lt(fee)) {
                tr.fee(fee.toNumber());
            }

            const currentFee = toBN(tr.getFee());
            const relayFeePerB = getRelayFeePerKB(this.chainType).divn(1000).muln(this.services.transactionFeeService.feeIncrease);
            const txSize = tr._estimateSize();

            const allFee = currentFee.add(toBN(txSize).mul(relayFeePerB));
            tr.fee(allFee.toNumber());
            logger.info(`Increasing RBF fee for transaction ${txDbId} from ${currentFee.toNumber()} satoshi to ${tr.getFee()} satoshi; estimated transaction size is ${txSize} (${tr.inputs.length} inputs, ${tr.outputs.length} outputs)`);
        }
    }

    // make fee lower if fee > maxFee
    private correctFeeDueToSuggestedFee(txDbId: number, tr: Transaction, usingSuggestedFee: boolean, isRBF: boolean, maxFee?: BN): BN {
        if (usingSuggestedFee && maxFee && toBN(tr.getFee()).gte(maxFee) && !isRBF) {
            logger.info(`Lowering fee for transaction ${txDbId} from ${tr.getFee()} satoshi to ${maxFee.toNumber()} satoshi (max fee);`);
            tr.fee(maxFee.toNumber());
            return maxFee;
        } else {
            return toBN(tr.getFee());
        }
    }

    private correctRBFRestrictions(txDbId: number, tr: Transaction, usingSuggestedFee: boolean, isRBF: boolean, maxFee?: BN): void {
        if (isRBF) {
            //TODO - original amount + maxFee >= rbf.amount + rbf.fee
        }
    }

    private checkIfAmountIsAllowed(txDbId: number, amount: BN, source: string): void {
        if (amount.lt(getDustAmount(this.chainType))) {
            logger.warn(`Will not prepare transaction ${txDbId}, for ${source}. Amount ${amount.toString()} is less than dust ${getDustAmount(this.chainType).toString()}`);
            throw new LessThanDustAmountError(
                `Will not prepare transaction ${txDbId}, for ${source}. Amount ${amount.toString()} is less than dust ${getDustAmount(this.chainType).toString()}`,
            );
        }
    }
    private checkIfEnoughUtxoToCoverAmount(txDbId: number, amount: BN, utxos: MempoolUTXO[], fee?: BN): void {
        const utxosValue = utxos.reduce((accumulator, utxo) => accumulator.add(utxo.value), new BN(0));
        if (utxos.length === 0 || utxosValue.lt(amount.add(fee ?? new BN(0)))) {
            logger.warn(`Not enough UTXOs for creating transaction ${txDbId}; utxosAmount: ${utxosValue.toString()}, needed amount ${amount.toString()}`);
            throw new NotEnoughUTXOsError(`Not enough UTXOs for creating transaction ${txDbId}; utxosAmount: ${utxosValue.toString()}, needed amount ${amount.toString()}`);
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
