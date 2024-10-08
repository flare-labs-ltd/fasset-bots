import BN from "bn.js";
import { logger } from "../../utils/logger";
import {
    checkIfIsDeleting,
    correctUTXOInconsistenciesAndFillFromMempool,
    createInitialTransactionEntity, fetchUnspentUTXOs, setAccountIsDeleting,
} from "../../db/dbutils";
import { ServiceRepository } from "../../ServiceRepository";
import { EntityManager } from "@mikro-orm/core";
import {
    ChainType,
} from "../../utils/constants";
import { TransactionEntity } from "../../entity/transaction";
import { UTXOEntity } from "../../entity/utxo";
import * as bitcore from "bitcore-lib";
import { Transaction } from "bitcore-lib";
import {
    getAccountBalance,
    getCore,
    getDustAmount,
    getOutputSize,
} from "./UTXOUtils";
import { unPrefix0x } from "../../utils/utils";
import UnspentOutput = Transaction.UnspentOutput;
import { toBN, toNumber } from "../../utils/bnutils";
import { TransactionData, TransactionUTXOService } from "./TransactionUTXOService";
import { TransactionFeeService } from "./TransactionFeeService";
import { LessThanDustAmountError, NegativeFeeError, NotEnoughUTXOsError } from "../../utils/axios-error-utils";
import { UTXO } from "../../interfaces/IWalletTransaction";
import { BlockchainAPIWrapper } from "../../blockchain-apis/UTXOBlockchainAPIWrapper";

export class TransactionService {

    private readonly chainType: ChainType;
    private readonly transactionFeeService: TransactionFeeService;
    private readonly rootEm: EntityManager;

    constructor(chainType: ChainType) {
        this.chainType = chainType;
        this.transactionFeeService = ServiceRepository.get(this.chainType, TransactionFeeService);
        this.rootEm = ServiceRepository.get(this.chainType, EntityManager);
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
        logger.info(`Received request to create transaction from ${source} to ${destination} with amount ${amountInSatoshi?.toString()} and reference ${note}, with limits ${executeUntilBlock} and ${executeUntilTimestamp?.toString()}`);
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
        const blockchainApi = ServiceRepository.get(this.chainType, BlockchainAPIWrapper);
        const utxosFromMempool = await blockchainApi.getUTXOsFromMempool(source);
        await correctUTXOInconsistenciesAndFillFromMempool(this.rootEm, source, utxosFromMempool);

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
        const feePerKBOriginal = await this.transactionFeeService.getFeePerKB();
        const feePerKB = feePerKBOriginal;

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
            utxos = await utxoService.fetchUTXOs(txData, txForReplacement);
        }

        const utxosAmount = utxos.reduce((accumulator, utxo) => accumulator.add(utxo.value), new BN(0));

        if (utxos.length === 0 || utxosAmount.lt(amountInSatoshi.add(feeInSatoshi ?? new BN(0)))) {
            logger.warn(`Not enough UTXOs for creating transaction ${txDbId}; utxosAmount: ${utxosAmount.toString()}, needed amount ${amountInSatoshi.toString()}`)
            throw new NotEnoughUTXOsError(`Not enough UTXOs for creating transaction ${txDbId}; utxosAmount: ${utxosAmount.toString()}, needed amount ${amountInSatoshi.toString()}`);
        }

        if (amountInSatoshi.lte(getDustAmount(this.chainType))) {
            logger.warn(`Will not prepare transaction ${txDbId}, for ${source}. Amount ${amountInSatoshi.toString()} is less than dust ${getDustAmount(this.chainType).toString()}`);
            throw new LessThanDustAmountError(
                `Will not prepare transaction ${txDbId}, for ${source}. Amount ${amountInSatoshi.toString()} is less than dust ${getDustAmount(this.chainType).toString()}`,
            );
        }

        const tr = this.createBitcoreTransaction(source, destination, amountInSatoshi, feeInSatoshi, feePerKB, utxos, isPayment, note);

        if (feeInSatoshi && !txForReplacement) {
            tr.fee(toNumber(feeInSatoshi));
        }

        if (isPayment && !feeInSatoshi || txForReplacement) {
            let feeRatePerKB: BN = await this.transactionFeeService.getFeePerKB();
            logger.info(`Transaction ${txDbId} received fee of ${feeRatePerKB.toString()} satoshies per kb.`);
            if (txForReplacement && feeInSatoshi) {
                const feeToCover: BN = feeInSatoshi;
                if (txForReplacement.size && txForReplacement.fee) {
                    const minRequiredFeePerKb: BN = toBN(txForReplacement.fee.divn(txForReplacement.size).muln(1000)).muln(this.transactionFeeService.feeIncrease);
                    if (feeRatePerKB.lt(minRequiredFeePerKb)) {
                        feeRatePerKB = minRequiredFeePerKb;
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

        return [tr, utxos];
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