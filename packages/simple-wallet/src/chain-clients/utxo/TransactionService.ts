import BN, { max } from "bn.js";
import { logger } from "../../utils/logger";
import { createInitialTransactionEntity, setAccountIsDeleting, } from "../../db/dbutils";
import { EntityManager } from "@mikro-orm/core";
import { ChainType, MAX_NUM_OF_INPUT_UTXOS, } from "../../utils/constants";
import { TransactionEntity } from "../../entity/transaction";
import { Transaction } from "bitcore-lib";
import { calculateFeePerKBFromTransactionEntity, getAccountBalance, getCore, getDustAmount, getMinimalAllowedFeePerKB, getOutputSize, getRelayFeePerKB, getMinimumUsefulUTXOValue } from "./UTXOUtils";
import { toBN } from "../../utils/bnutils";
import { TransactionUTXOService } from "./TransactionUTXOService";
import { TransactionFeeService } from "./TransactionFeeService";
import { LessThanDustAmountError, MissingFieldError, NegativeFeeError, NotEnoughUTXOsError, RBFRestrictionsNotMetError } from "../../utils/axios-utils";
import { TransactionData, UTXO } from "../../interfaces/IWalletTransaction";
import { IUtxoWalletServices } from "./IUtxoWalletServices";
import { MempoolUTXO } from "../../interfaces/IBlockchainAPI";


export class TransactionService {

    private readonly services: IUtxoWalletServices;
    private readonly chainType: ChainType;
    private readonly transactionFeeService: TransactionFeeService;
    private readonly rootEm: EntityManager;
    private readonly utxoService: TransactionUTXOService;

    desiredChangeValue: BN;

    constructor(services: IUtxoWalletServices, chainType: ChainType, desiredChangeValue: BN) {
        this.services = services;
        this.chainType = chainType;
        this.transactionFeeService = services.transactionFeeService;
        this.rootEm = services.rootEm;
        this.utxoService = services.transactionUTXOService;
        this.desiredChangeValue = desiredChangeValue;
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

        const feePerKBFromFeeService = await this.transactionFeeService.getFeePerKB();
        logger.info(`Transaction ${txDbId} received ${feePerKBFromFeeService.toString()} feePerKb from fee service.`);
        // rbf payment
        if (txForReplacement && amountInSatoshi && txForReplacement.fee) {
            const txForReplacementFeePerKB = calculateFeePerKBFromTransactionEntity(txDbId, txForReplacement);
            const additionalFeePerKB = getMinimalAllowedFeePerKB(this.chainType).divn(2);
            const feePerKB = max(txForReplacementFeePerKB, feePerKBFromFeeService.add(additionalFeePerKB));
            logger.info(`RBF transaction ${txDbId} is using ${feePerKB.toString()} feePerKb.`);
            return this.prepareRBFTransaction(txDbId, source, destination, amountInSatoshi, feePerKB, txForReplacement, txForReplacement.fee, note);
        } else if (txForReplacement && amountInSatoshi === null) {
            throw new MissingFieldError (
                `Will not prepare rbf transaction ${txDbId}, for ${source}. Amount is not defined.`,
            );
        } else if (txForReplacement) {
            throw new MissingFieldError (
                `Will not prepare rbf transaction ${txDbId}, for ${source}. Missing fields in original tx ${txForReplacement.id}.`,
            );
        }
        // free underlying payment
        if (freeUnderlying && amountInSatoshi) {
            return this.prepareFreeUnderlyingPaymentTransaction(txDbId, source, destination, amountInSatoshi, feePerKBFromFeeService, feeInSatoshi, note);
        } else if (freeUnderlying && amountInSatoshi === null) {
            throw new MissingFieldError (
                `Will not prepare transaction ${txDbId}, for ${source}. Amount is not defined.`,
            );
        }
        // redemption payment
        if (feeSource && amountInSatoshi && !txForReplacement) {
            return this.preparePaymentTransactionWithAdditionalFeeWallet(txDbId, source, feeSource, destination, amountInSatoshi, feePerKBFromFeeService, minFeePerKB, feeInSatoshi, maxFee, maxFeeForFeeSource, note);
        } else { // redemption payment and delete account
            return this.preparePaymentTransactionWithSingleWallet(txDbId, source, destination, amountInSatoshi, feePerKBFromFeeService, minFeePerKB, feeInSatoshi, maxFee, note);
        }
    }

    async preparePaymentTransactionWithSingleWallet(
        txDbId: number,
        source: string,
        destination: string,
        amountInSatoshi: BN | null,
        feePerKB: BN,
        suggestedFeePerKB?: BN,
        feeInSatoshi?: BN,
        maxFee?: BN,
        note?: string
    ): Promise<[Transaction, MempoolUTXO[]]> {
        const isPayment = amountInSatoshi != null;
        logger.info(`Preparing ${isPayment ? "payment": "delete"} transaction ${txDbId}`);

        if (amountInSatoshi == null) {
            let utxos = await this.utxoService.sortedMempoolUTXOs(source); // fetch all utxos
            // In case that account has large number of UTXOs the "delete account transactions" is created as a sequence of smaller transactions
            const useMultipleTransactions = utxos.length > MAX_NUM_OF_INPUT_UTXOS;
            if (useMultipleTransactions) {
                utxos = utxos.slice(0, MAX_NUM_OF_INPUT_UTXOS);
            }
            // Fee should be reduced for 1 one output, this is because the transaction above is calculated using change, because bitcore otherwise uses everything as fee
            const bitcoreTx = await this.utxoService.createBitcoreTransaction(source, destination, new BN(0), undefined, feePerKB, utxos, true, note);
            feeInSatoshi = toBN(bitcoreTx.getFee()).sub(feePerKB.muln(getOutputSize(this.chainType)).divn(1000));
            if (feeInSatoshi.ltn(0)) {
                logger.warn(`Will not prepare transaction ${txDbId}, for ${source}. Negative fee ${feeInSatoshi.toString()}`);
                throw new NegativeFeeError(
                    `Will not prepare transaction ${txDbId}, for ${source}. Amount ${feeInSatoshi.toString()}`,
                );
            }
            if (useMultipleTransactions) {
                amountInSatoshi = utxos.reduce((acc: BN, t: MempoolUTXO) => acc.add(t.value), new BN(0)).sub(feeInSatoshi);
            } else {
                const balance = await getAccountBalance(this.services.blockchainAPI, source);
                amountInSatoshi = balance.sub(feeInSatoshi);
            }
            this.checkIfAmountIsNotDust(txDbId, amountInSatoshi, source);

            const tr = await this.utxoService.createBitcoreTransaction(source, destination, amountInSatoshi, feeInSatoshi, feePerKB, utxos, isPayment, note);

            return [tr, utxos];
        } else {
            let usingSuggestedFee = false;
            if (suggestedFeePerKB && suggestedFeePerKB.gtn(0) && suggestedFeePerKB.gte(feePerKB)) {
                usingSuggestedFee = true;
            }
            this.checkIfAmountIsNotDust(txDbId, amountInSatoshi, source);
            const txData: TransactionData = {
                txId: txDbId,
                source: source,
                destination: destination,
                amount: amountInSatoshi,
                fee: feeInSatoshi,
                feePerKB: usingSuggestedFee ? suggestedFeePerKB : feePerKB,
                useChange: isPayment,
                note: note,
                desiredChangeValue: this.desiredChangeValue
            };
            const validChoices = await this.utxoService.fetchUTXOs(txData);
            if (!validChoices) {
                throw new NotEnoughUTXOsError(`Not enough UTXOs for creating transaction ${txDbId}`)
            }
            let selectionWithLowestInputs: MempoolUTXO[] | null = null;
            for (const utxos of validChoices) {
                const tr = await this.utxoService.createBitcoreTransaction(source, destination, amountInSatoshi, feeInSatoshi, txData.feePerKB, utxos, isPayment, note);
                const txFee = toBN(tr.getFee());

                if (!maxFee) {
                    return [tr, utxos];
                } else if (maxFee && maxFee.gtn(0) && txFee.lte(maxFee)) { // if any selection satisfy, use it
                    return [tr, utxos];
                }
                if (selectionWithLowestInputs === null || (selectionWithLowestInputs && selectionWithLowestInputs.length > utxos.length)) {
                    selectionWithLowestInputs = utxos;
                }
            }
            // no selection satisfied && suggested fee is used
            if (usingSuggestedFee && selectionWithLowestInputs && maxFee) {
                const tr = await this.utxoService.createBitcoreTransaction(source, destination, amountInSatoshi, maxFee, undefined, selectionWithLowestInputs, isPayment, note);
                logger.info(`Lowering fee for transaction ${txDbId} to ${maxFee.toNumber()} satoshi (max fee);`);
                return [tr, selectionWithLowestInputs];
            }

            throw new NotEnoughUTXOsError(`Unable to construct transaction ${txDbId} and satisfy restrictions.`)
        }
    }

    async preparePaymentTransactionWithAdditionalFeeWallet(
        txDbId: number,
        source: string,
        feeSource: string,
        destination: string,
        amountInSatoshi: BN,
        feePerKB: BN,
        suggestedFeePerKB?: BN,
        feeInSatoshi?: BN,
        maxFee?: BN,
        maxFeeForFeeSource?: BN,
        note?: string
    ): Promise<[Transaction, MempoolUTXO[]]> {
        logger.info(`Preparing payment transaction ${txDbId} with additional wallet`);

        let usingSuggestedFee = false;
        if (suggestedFeePerKB && suggestedFeePerKB.gtn(0) && suggestedFeePerKB.gte(feePerKB)) {
            usingSuggestedFee = true;
        }

        this.checkIfAmountIsNotDust(txDbId, amountInSatoshi, source);
        const txDataForAmount: TransactionData = {
            txId: txDbId,
            source: source,
            destination: destination,
            amount: amountInSatoshi,
            fee: toBN(0),
            feePerKB: usingSuggestedFee ? suggestedFeePerKB : feePerKB,
            useChange: true,
            note: note,
            desiredChangeValue: this.desiredChangeValue
        };

        const validChoicesForAmount = await this.utxoService.fetchUTXOs(txDataForAmount);
        if (!validChoicesForAmount) {
            throw new NotEnoughUTXOsError(`Not enough UTXOs for creating transaction ${txDbId}`)
        }

        const baseTransaction = await this.utxoService.createBitcoreTransaction(source, destination, amountInSatoshi, feeInSatoshi, txDataForAmount.feePerKB, validChoicesForAmount[0], true, note);
        // If fee is lower than dust ignore the fee source
        if (toBN(baseTransaction.getFee()).lte(getDustAmount(this.chainType))) {
            logger.info(`Transaction ${txDbId} will be prepared with single wallet - fee is lower than dust ${baseTransaction.getFee()}`);
            return this.preparePaymentTransactionWithSingleWallet(txDbId, source, destination, amountInSatoshi, feePerKB, suggestedFeePerKB, feeInSatoshi, maxFee, note);
        }

        const txDataForFee: TransactionData = {
            txId: txDbId,
            source: feeSource,
            destination: destination,
            amount: toBN(baseTransaction.getFee()),
            fee: toBN(0),
            feePerKB: usingSuggestedFee ? suggestedFeePerKB : feePerKB,
            useChange: true,
            note: note,
            desiredChangeValue: getMinimumUsefulUTXOValue(this.chainType)
        };

        const validChoicesForFee = await this.utxoService.fetchUTXOs(txDataForFee);
        if (!validChoicesForFee) { // if no utxos for feeSource -> create only base transaction
            logger.info(`Transaction ${txDbId} will be prepared with single wallet - no utxos for fee wallet.`);
            return this.preparePaymentTransactionWithSingleWallet(txDbId, source, destination, amountInSatoshi, feePerKB, suggestedFeePerKB, feeInSatoshi, maxFee, note);
        }

        const utxos: MempoolUTXO[] = validChoicesForAmount[0].concat(validChoicesForFee[0]);

        const utxosForFeeAmount = validChoicesForFee[0].reduce((accumulator, utxo) => accumulator.add(utxo.value), new BN(0));
        let tr = await this.utxoService.createBitcoreTransaction(source, destination, amountInSatoshi, feeInSatoshi, txDataForAmount.feePerKB, utxos, true, note);

        let feeToUse = toBN(tr.getFee());
        let feeRemainder = utxosForFeeAmount.sub(feeToUse);

        if (!usingSuggestedFee && maxFeeForFeeSource && feeToUse.gt(maxFeeForFeeSource)) { // fee > maxFeeSource -> create only base transaction
            logger.info(`Transaction ${txDbId} will be prepared with single wallet - maxFeeForFeeSource exceeded ${feeToUse.toString()} > ${maxFeeForFeeSource.toString()}`);
            return this.preparePaymentTransactionWithSingleWallet(txDbId, source, destination, amountInSatoshi, feePerKB, suggestedFeePerKB, feeInSatoshi, maxFee, note);
        }

        if (feeRemainder.gt(getDustAmount(this.chainType))) {
            if (usingSuggestedFee && maxFeeForFeeSource && feeToUse.gt(maxFeeForFeeSource)) {
                logger.info(`Lowering fee for transaction ${txDbId} to ${maxFeeForFeeSource.toNumber()} satoshi (max fee);`);
                feeToUse = maxFeeForFeeSource;
                feeRemainder = utxosForFeeAmount.sub(maxFeeForFeeSource);
            } else {
                const correctedFee = toBN(tr.getFee()).add(feeInSatoshi ? toBN(0) : feePerKB.muln(getOutputSize(this.chainType)).divn(1000)); // Fee should be higher since we have additional output
                feeToUse = correctedFee;
                feeRemainder = utxosForFeeAmount.sub(feeToUse);
            }
            if (feeRemainder.gt(getDustAmount(this.chainType))) {
                tr = await this.utxoService.createBitcoreTransaction(source, destination, amountInSatoshi, feeToUse, undefined, utxos, true, note, feeSource, feeRemainder);
            }
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
        note?: string
    ): Promise<[Transaction, MempoolUTXO[]]> {
        logger.info(`Preparing free underlying transaction ${txDbId}`);
        const txData: TransactionData = {
            txId: txDbId,
            source: source,
            destination: destination,
            amount: amountInSatoshi,
            fee: feeInSatoshi ?? toBN(0),
            feePerKB: feePerKB,
            useChange: true,
            note: note,
            desiredChangeValue: this.desiredChangeValue
        };
        const validChoices = await this.utxoService.fetchUTXOs(txData);
        if (!validChoices) {
            throw new NotEnoughUTXOsError(`Not enough UTXOs for creating transaction ${txDbId}`)
        }

        if (feeInSatoshi) {
            const amountToSend = txData.amount.sub(feeInSatoshi);
            const feeToUse = feeInSatoshi;
            const utxos = validChoices[0];
            this.checkIfAmountIsNotDust(txDbId, amountToSend, source);
            const tr = await this.utxoService.createBitcoreTransaction(source, destination, amountToSend, feeToUse, undefined, utxos, true, note);

            return [tr, utxos];
        } else {
            let utxosToUse: MempoolUTXO[] = [];
            let smallestFee: BN | null = null;
            for (const utxos of validChoices) {
                const tr = await this.utxoService.createBitcoreTransaction(source, destination, amountInSatoshi, undefined, txData.feePerKB, utxos, true, note);
                const txFee = toBN(tr.getFee());
                if (smallestFee === null || smallestFee.gt(txFee)) {
                    smallestFee = txFee;
                    utxosToUse = utxos;
                }
            }
            if (smallestFee && utxosToUse.length > 0) {
                const feeToUse = smallestFee;
                const amountToSend = txData.amount.sub(feeToUse);
                this.checkIfAmountIsNotDust(txDbId, amountToSend, source);
                const tr = await this.utxoService.createBitcoreTransaction(source, destination, amountToSend, feeToUse, undefined, utxosToUse, true, note);

                return [tr, utxosToUse];
            }
            throw new NotEnoughUTXOsError(`Unable to construct transaction ${txDbId} and satisfy restrictions.`)
        }
    }

    async prepareRBFTransaction(
        txDbId: number,
        source: string,
        destination: string,
        amountInSatoshi: BN,
        feePerKB: BN,
        txForReplacement: TransactionEntity,
        feeToCover: BN,
        note?: string
    ): Promise<[Transaction, MempoolUTXO[]]> {
        logger.info(`Preparing rbf transaction ${txDbId} for transaction ${txForReplacement.id}`);
        if (txForReplacement.raw) {
            const rbfUTXOs = await this.utxoService.getRbfUTXOs(source, txForReplacement.raw);
            const amountToSend = txForReplacement.isFreeUnderlyingTransaction ? amountInSatoshi.sub(feeToCover) : amountInSatoshi;
            // fail if amount less than dust or amount-fee less than dust in case of freeUnderlying
            this.checkIfAmountIsNotDust(txDbId, amountToSend, source);

            let tr = await this.utxoService.createBitcoreTransaction(source, destination, amountToSend, undefined, feePerKB, rbfUTXOs, true, note);
            await this.correctFeeForRBF(txDbId, tr, feeToCover);

            let amountToSendLast = amountToSend;
            if (txForReplacement.isFreeUnderlyingTransaction) {
                const feeToUse = toBN(tr.getFee())
                amountToSendLast = amountInSatoshi.sub(feeToUse);
                tr = await this.utxoService.createBitcoreTransaction(source, destination, amountToSendLast, feeToUse, undefined, rbfUTXOs, true, note);
                // fail if amount less than dust or amount-fee less than dust in case of freeUnderlying
                this.checkIfAmountIsNotDust(txDbId, amountToSendLast, source);
            }
            const feeToUse = toBN(tr.getFee());
            const RBFRestrictionsMet = this.checkRBFRestrictionsMet(txDbId, txForReplacement, amountToSendLast, feeToUse);
            if (!RBFRestrictionsMet) {
                throw new RBFRestrictionsNotMetError (
                    `Cannot prepare rbf transaction ${txDbId}, for ${source}. RBF restrictions are not met.`,
                );
            }
            // TODO what if not enough utxos to cover - add confirmed ones
            return [tr, rbfUTXOs];
        } else {
            throw new MissingFieldError (
                `Will not prepare rbf transaction ${txDbId}, for ${source}. Filed raw is not defined.`,
            );
        }

    }

    private async correctFeeForRBF(txDbId: number, tr: Transaction, feeToCover: BN): Promise<void> {
        const currentFee = toBN(tr.getFee());
        const relayFeePerB = getRelayFeePerKB(this.chainType).divn(1000).muln(this.services.transactionFeeService.feeIncrease);
        const txSize = tr._estimateSize();
        const relayFee = toBN(txSize).mul(relayFeePerB);
        if (feeToCover.gt(currentFee)) {
            const increase = feeToCover.add(relayFee);
            tr.fee(increase.toNumber());
            logger.info(`Increasing RBF fee for transaction ${txDbId} from ${currentFee.toNumber()} satoshis to ${increase.toString()} satoshis; estimated transaction size is ${txSize} (${tr.inputs.length} inputs, ${tr.outputs.length} outputs)`);
        } else {
            const increase = currentFee.add(relayFee);
            tr.fee(increase.toNumber());
            logger.info(`Increasing RBF fee for relay fee for transaction ${txDbId} from ${currentFee.toString()} satoshis to ${increase.toString()} satoshis; estimated transaction size is ${txSize} (${tr.inputs.length} inputs, ${tr.outputs.length} outputs)`);
        }
    }

    private checkRBFRestrictionsMet(txDbId: number, originalTx: TransactionEntity, amountToSend:BN, feeToUse: BN): boolean {
        if (originalTx.isFreeUnderlyingTransaction && originalTx.amount) {
            if(!originalTx.amount.gte(amountToSend.add(feeToUse))) {
                logger.warn(`RBF restrictions for transaction ${txDbId} were not met. RBF free underlying transaction has ${originalTx.amount.toString()} lower than ${amountToSend.toString()} and ${feeToUse.toString()}`);
                return false;
            }
        } else if (!originalTx.isFreeUnderlyingTransaction && originalTx.amount && originalTx.maxFee) {
            if(!originalTx.amount.add(originalTx.maxFee).gte(amountToSend.add(feeToUse))) { // in case of redemption this should not happen as rbf amount is way lower than original one
                logger.warn(`RBF restrictions for transaction ${txDbId} were not met. RBF transaction has ${originalTx.amount.toString()} and ${originalTx.maxFee.toString()} lower than ${amountToSend.toString()} and ${feeToUse.toString()}`);
                return false;
            }
        }
        return true;
    }

    private checkIfAmountIsNotDust(txDbId: number, amount: BN, source: string): void {
        if (amount.lt(getDustAmount(this.chainType))) {
            logger.warn(`Will not prepare transaction ${txDbId}, for ${source}. Amount ${amount.toString()} is less than dust ${getDustAmount(this.chainType).toString()}`);
            throw new LessThanDustAmountError(
                `Will not prepare transaction ${txDbId}, for ${source}. Amount ${amount.toString()} is less than dust ${getDustAmount(this.chainType).toString()}`,
            );
        }
    }
}