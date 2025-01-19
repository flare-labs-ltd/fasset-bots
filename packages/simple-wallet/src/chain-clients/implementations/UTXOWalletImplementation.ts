import axios, { AxiosError } from "axios";
import * as bitcore from "bitcore-lib";
import {
    checkIfFeeTooHigh,
    checkIfShouldStillSubmit, createMonitoringId, getCurrentTimestampInSeconds,
    sleepMs,
    stuckTransactionConstants
} from "../../utils/utils";
import { toBN, toNumber } from "../../utils/bnutils";
import { ChainType, MAX_UTXO_TX_SIZE_IN_B, MEMPOOL_WAITING_TIME, UNKNOWN_DESTINATION, UNKNOWN_SOURCE } from "../../utils/constants";
import {
    BaseWalletConfig,
    ITransactionMonitor,
    IWalletKeys,
    SignedObject,
    TransactionInfo,
    UTXOFeeParams,
    WriteWalletInterface,
} from "../../interfaces/IWalletTransaction";

import BN, { max } from "bn.js";
import {
    checkIfIsDeleting, createInitialTransactionEntity,
    failDueToNoTimeToSubmit,
    failTransaction,
    fetchTransactionEntityById,
    getTransactionInfoById,
    handleFeeToLow,
    handleMissingPrivateKey,
    resetTransactionEntity,
    transactional, updateTransactionEntity
} from "../../db/dbutils";
import { logger } from "../../utils/logger";
import { UTXOAccountGeneration } from "../account-generation/UTXOAccountGeneration";
import { TransactionEntity, TransactionStatus } from "../../entity/transaction";
import { BlockchainFeeService } from "../../fee-service/fee-service";
import { EntityManager } from "@mikro-orm/core";
import {
    checkUTXONetworkStatus,
    getAccountBalance, getCore,
    getMinAmountToSend,
    getTransactionDescendants,
} from "../utxo/UTXOUtils";
import { CreateWalletOverrides, IMonitoredWallet, TransactionMonitor } from "../monitoring/TransactionMonitor";
import { TransactionService } from "../utxo/TransactionService";
import { TransactionUTXOService } from "../utxo/TransactionUTXOService";
import { TransactionFeeService } from "../utxo/TransactionFeeService";
import {
    errorMessage,
    isORMError,
    LessThanDustAmountError,
    MissingAmountError,
    NegativeFeeError,
    NotEnoughUTXOsError,
} from "../../utils/axios-utils";
import { AxiosTransactionSubmissionError, UTXORawTransaction } from "../../interfaces/IBlockchainAPI";
import { UTXOBlockchainAPI } from "../../blockchain-apis/UTXOBlockchainAPI";
import { IUtxoWalletServices } from "../utxo/IUtxoWalletServices";

export abstract class UTXOWalletImplementation extends UTXOAccountGeneration implements WriteWalletInterface, IMonitoredWallet, IUtxoWalletServices {
    inTestnet: boolean;
    rootEm: EntityManager;
    transactionFeeService: TransactionFeeService;
    transactionService: TransactionService;
    transactionUTXOService: TransactionUTXOService;
    blockchainAPI: UTXOBlockchainAPI;
    walletKeys!: IWalletKeys;
    blockOffset: number;
    feeIncrease: number;
    executionBlockOffset: number;
    feeService: BlockchainFeeService;
    enoughConfirmations: number;

    monitoringId: string;
    createConfig: BaseWalletConfig;

    constructor(chainType: ChainType, createConfig: BaseWalletConfig, overrides: CreateWalletOverrides) {
        super(chainType);
        this.monitoringId = overrides.monitoringId ?? createMonitoringId(chainType);
        this.createConfig = createConfig;
        this.inTestnet = createConfig.inTestnet ?? false;
        const resubmit = stuckTransactionConstants(this.chainType);

        this.blockOffset = createConfig.stuckTransactionOptions?.blockOffset ?? resubmit.blockOffset!;

        this.feeIncrease = createConfig.stuckTransactionOptions?.feeIncrease ?? resubmit.feeIncrease!;
        this.executionBlockOffset = createConfig.stuckTransactionOptions?.executionBlockOffset ?? resubmit.executionBlockOffset!;
        this.rootEm = overrides.walletEm ?? createConfig.em;
        this.walletKeys = createConfig.walletKeys;
        this.enoughConfirmations = createConfig.enoughConfirmations ?? resubmit.enoughConfirmations!;

        this.blockchainAPI = new UTXOBlockchainAPI(createConfig, this.chainType);
        this.transactionFeeService = new TransactionFeeService(this, this.chainType, this.feeIncrease);
        this.transactionUTXOService = new TransactionUTXOService(this, this.chainType, this.enoughConfirmations);
        this.transactionService = new TransactionService(this, this.chainType);
        this.feeService = overrides.feeService ?? new BlockchainFeeService(this.rootEm, this.blockchainAPI, this.chainType, this.monitoringId);
    }

    abstract clone(data: CreateWalletOverrides): UTXOWalletImplementation;

    getMonitoringId(): string {
        return this.monitoringId;
    }

    async getAccountBalance(account: string): Promise<BN> {
        logger.info(`Received request to fetch balance for account ${account}.`);
        return await getAccountBalance(this.blockchainAPI, account);
    }

    /**
     * @param {UTXOFeeParams} params - basic data needed to estimate fee
     * @returns {BN} - current transaction/network fee in satoshis
     */
    async getCurrentTransactionFee(params: UTXOFeeParams): Promise<BN> {
        logger.info(`Received request to fetch current transaction fee with params ${params.source}, ${params.destination} and ${params.amount?.toString()}.`);
        try {
            const [transaction] = await this.transactionService.preparePaymentTransaction(
                0,
                params.source,
                params.destination,
                params.amount ?? null,
                undefined,
                params.note,
                undefined,
                params.feeSource,
            );
            return toBN(transaction.getFee());
        } catch (error) /* istanbul ignore next */ {
            logger.error(`Cannot get current transaction fee for params ${params.source}, ${params.destination} and ${params.amount?.toString()}: ${errorMessage(error)}`);
            throw error;
        }
    }

    /**
     * @param {number} dbId
     * @returns {Object} - containing transaction info
     */
    async getTransactionInfo(dbId: number): Promise<TransactionInfo> {
        return await getTransactionInfoById(this.rootEm, dbId);
    }

    /**
     * @param {string} source
     * @param {string} destination
     * @param {BN|null} amountInSatoshi - if null => empty all funds
     * @param {BN|undefined} feeInSatoshi - automatically set if undefined
     * @param {string|undefined} note
     * @param {BN|undefined} maxFeeInSatoshi
     * @param executeUntilBlock
     * @param executeUntilTimestamp
     * @param isFreeUnderlying - transfer funds where fee is allocated from amount if it's not directly specified
     * @param feeSource - address of the wallet which is used for paying transaction fees
     * @param maxPaymentForFeeSource
     * @returns {Object} - containing transaction id tx_id and optional result
     */
    async createPaymentTransaction(
        source: string,
        destination: string,
        amountInSatoshi: BN | null,
        feeInSatoshi?: BN,
        note?: string,
        maxFeeInSatoshi?: BN,
        executeUntilBlock?: number,
        executeUntilTimestamp?: BN,
        isFreeUnderlying?: boolean,
        feeSource?: string,
        maxPaymentForFeeSource?: BN,
        minFeePerKB?: BN
    ): Promise<number> {
        if (await checkIfIsDeleting(this.rootEm, source)) {
            logger.error(`Cannot receive requests. ${source} is deleting`);
            throw new Error(`Cannot receive requests. ${source} is deleting`);
        }
        const privateKey = await this.walletKeys.getKey(source);
        const privateKeyForFee = feeSource ? await this.walletKeys.getKey(feeSource) : undefined;

        if (!privateKey) {
            logger.error(`Cannot prepare transaction ${source}. Missing private key.`);
            throw new Error(`Cannot prepare transaction ${source}. Missing private key.`);
        }
        if (feeSource && !privateKeyForFee) {
            logger.error(`Cannot prepare transaction ${source}. Missing private key for fee wallet.`);
            throw new Error(`Cannot prepare transaction ${source}. Missing private key for fee wallet.`);
        }
        // If maxFeeInSatoshi is not defined && feeInSatoshi is defined => maxFeeInSatoshi = feeInSatoshi
        if (!maxFeeInSatoshi && feeInSatoshi) {
            maxFeeInSatoshi = feeInSatoshi;
        }

        return this.transactionService.createPaymentTransaction(
            this.chainType,
            source,
            destination,
            amountInSatoshi,
            feeInSatoshi,
            note,
            maxFeeInSatoshi,
            executeUntilBlock,
            executeUntilTimestamp,
            feeSource,
            maxPaymentForFeeSource,
            isFreeUnderlying,
            minFeePerKB
        );
    }

    /**
     * @param {string} source
     * @param {string} destination
     * @param {BN|undefined} feeInSatoshi - automatically set if undefined
     * @param {string|undefined} note
     * @param {BN|undefined} maxFeeInSatoshi
     * @param executeUntilBlock
     * @param executeUntilTimestamp
     * @returns {Object} - containing transaction id tx_id and optional result
     */
    async createDeleteAccountTransaction(
        source: string,
        destination: string,
        feeInSatoshi?: BN,
        note?: string,
        maxFeeInSatoshi?: BN,
        executeUntilBlock?: number,
        executeUntilTimestamp?: BN
    ): Promise<number> {
        const privateKey = await this.walletKeys.getKey(source);
        if (!privateKey) {
            logger.error(`Cannot prepare transaction ${source}. Missing private key.`);
            throw new Error(`Cannot prepare transaction ${source}. Missing private key.`);
        }
        // If maxFeeInSatoshi is not defined && feeInSatoshi is defined => maxFeeInSatoshi = feeInSatoshi
        if (!maxFeeInSatoshi && feeInSatoshi) {
            maxFeeInSatoshi = feeInSatoshi;
        }

        return this.transactionService.createDeleteAccountTransaction(
            this.chainType,
            source,
            destination,
            feeInSatoshi,
            note,
            maxFeeInSatoshi,
            executeUntilBlock,
            executeUntilTimestamp
        );
    }

    ///////////////////////////////////////////////////////////////////////////////////////
    // MONITORING /////////////////////////////////////////////////////////////////////////
    ///////////////////////////////////////////////////////////////////////////////////////

    async createMonitor(): Promise<ITransactionMonitor> {
        return new TransactionMonitor(this.chainType, this.rootEm, this.clone.bind(this), this.feeService);
    }

    async checkNetworkStatus(): Promise<boolean> {
        return await checkUTXONetworkStatus(this);
    }

    ///////////////////////////////////////////////////////////////////////////////////////
    // HELPER OR CLIENT SPECIFIC FUNCTIONS ////////////////////////////////////////////////
    ///////////////////////////////////////////////////////////////////////////////////////
    async prepareAndSubmitCreatedTransaction(txEnt: TransactionEntity): Promise<void> {
        const currentBlockNumber = await this.blockchainAPI.getCurrentBlockHeight();
        const shouldSubmit = checkIfShouldStillSubmit(this, currentBlockNumber, txEnt.executeUntilBlock, txEnt.executeUntilTimestamp);
        if (txEnt.rbfReplacementFor == null && !shouldSubmit) {
            const medianTime = this.feeService.getLatestMedianTime();
            await failDueToNoTimeToSubmit(this.rootEm, medianTime, currentBlockNumber, txEnt, "prepareAndSubmitCreatedTransaction");
            return;
        } else if (!txEnt.executeUntilBlock && !txEnt.executeUntilTimestamp) {
            await updateTransactionEntity(this.rootEm, txEnt.id, (txEnt) => {
                txEnt.executeUntilBlock = currentBlockNumber + this.blockOffset;
            });
        }
        logger.info(`Preparing transaction ${txEnt.id}`);
        try {
            const utxosFromMempool = await this.blockchainAPI.getUTXOsFromMempool(txEnt.source);
            if (utxosFromMempool.length === 0) {
                logger.warn(`Will not prepare transaction ${txEnt.id}. No utxos available. Trying again.`);
                return;
            }

            // rbfReplacementFor is used since the RBF needs to use at least one of the UTXOs spent by the original transaction
            const rbfReplacementFor = txEnt.rbfReplacementFor ? await fetchTransactionEntityById(this.rootEm, txEnt.rbfReplacementFor.id) : undefined;
            let [transaction, dbUTXOs] = await this.transactionService.preparePaymentTransaction(
                txEnt.id,
                txEnt.source,
                txEnt.destination,
                txEnt.amount ?? null,
                txEnt.fee,
                txEnt.reference,
                rbfReplacementFor,
                txEnt.feeSource,
                txEnt.isFreeUnderlyingTransaction,
                txEnt.minFeePerKB,
                txEnt.maxFee,
                txEnt.maxPaymentForFeeSource
            );
            const privateKey = await this.walletKeys.getKey(txEnt.source);
            const privateKeyForFee = txEnt.feeSource ? await this.walletKeys.getKey(txEnt.feeSource) : undefined;

            /* istanbul ignore next */
            if (!privateKey || txEnt.feeSource && !privateKeyForFee) {
                await handleMissingPrivateKey(this.rootEm, txEnt.id, "prepareAndSubmitCreatedTransaction");
                return;
            }

            const feeToHighForMainSource = checkIfFeeTooHigh(toBN(transaction.getFee()), txEnt.maxFee ?? null);
            const feeToHighForFeeSource = checkIfFeeTooHigh(toBN(transaction.getFee()), txEnt.maxPaymentForFeeSource ?? null);

            if (txEnt.fee && feeToHighForMainSource) {
                await failTransaction(this.rootEm, txEnt.id, `Pre-set fee ${txEnt.fee} > max fee ${txEnt.maxFee}`);
                return;
            }

            let payingFeesFromFeeSource = !!txEnt.feeSource && !feeToHighForFeeSource;
            if (txEnt.feeSource && feeToHighForFeeSource && !feeToHighForMainSource) {
                // If amount to pay from fee source is too high - try to pay it from main source
                [transaction, dbUTXOs] = await this.transactionService.preparePaymentTransaction(
                    txEnt.id,
                    txEnt.source,
                    txEnt.destination,
                    txEnt.amount ?? null,
                    txEnt.fee,
                    txEnt.reference,
                    rbfReplacementFor,
                    undefined,
                    txEnt.isFreeUnderlyingTransaction,
                    txEnt.minFeePerKB,
                    txEnt.maxFee
                );
                logger.info(`Transaction ${txEnt.id} got fee ${transaction.getFee()} that is > max amount for fee wallet (${txEnt.maxPaymentForFeeSource})`);
                payingFeesFromFeeSource = false;
            } else if (txEnt.feeSource && feeToHighForFeeSource && feeToHighForMainSource && rbfReplacementFor) { //TODO - check
                // If transaction is rbf and amount to pay from fee source is too high for both - set it to the max of both
                const maxFee = max(txEnt.maxFee ?? toBN(0), txEnt.maxPaymentForFeeSource ?? toBN(0));
                if (maxFee.gtn(0)) {
                    transaction.fee(toNumber(maxFee));
                }
                payingFeesFromFeeSource = !!txEnt.maxPaymentForFeeSource && maxFee.eq(txEnt.maxPaymentForFeeSource) || !!txEnt.maxFee;
            }

            // If fee source is non-existent/doesn't have high enough max amount
            if (!payingFeesFromFeeSource && feeToHighForMainSource) {
                if (rbfReplacementFor && txEnt.maxFee) { // TODO-check
                    await updateTransactionEntity(this.rootEm, txEnt.id, (txEntToUpdate) => {
                        txEntToUpdate.fee = txEnt.maxFee!;
                    });
                } else {
                    await updateTransactionEntity(this.rootEm, txEnt.id, (txEntToUpdate) => {
                        txEntToUpdate.lastProcessingError = `Transaction ${txEnt.id} got fee ${transaction.getFee()} that is > max fee (${txEnt.maxFee}) - waiting for fees to decrease`;
                    });
                    logger.info(`Transaction ${txEnt.id} got fee ${transaction.getFee()} that is > max fee (${txEnt.maxFee}) - waiting for fees to decrease`);
                    return;
                }
            } else {
                const inputs = await this.transactionUTXOService.createInputsFromUTXOs(dbUTXOs, txEnt.id);
                await updateTransactionEntity(this.rootEm, txEnt.id, (txEntToUpdate) => {
                    txEntToUpdate.raw = JSON.stringify(transaction);
                    txEntToUpdate.status = TransactionStatus.TX_PREPARED;
                    txEntToUpdate.reachedStatusPreparedInTimestamp = toBN(getCurrentTimestampInSeconds());
                    txEntToUpdate.fee = toBN(transaction.getFee()); // set the new fee if the original one was null/wrong
                    txEntToUpdate.inputs.add(inputs);
                    txEntToUpdate.numberOfOutputs = transaction.outputs.length;
                });
                logger.info(`Transaction ${txEnt.id} prepared.`);
                await this.signAndSubmitProcess(txEnt.id, transaction, privateKey, privateKeyForFee);
            }
        } catch (error) {
            /* istanbul ignore next */
            {
                if (error instanceof NotEnoughUTXOsError) {
                    logger.warn(`Not enough UTXOs for transaction ${txEnt.id}, fetching them from mempool`);
                    // try to prepare again
                } else if (error instanceof LessThanDustAmountError) {
                    await failTransaction(this.rootEm, txEnt.id, error.message);
                } else if (error instanceof NegativeFeeError) {
                    await failTransaction(this.rootEm, txEnt.id, error.message);
                } else if (error instanceof MissingAmountError) {
                    await failTransaction(this.rootEm, txEnt.id, error.message);
                } else if (axios.isAxiosError(error)) {
                    const axiosError = error as AxiosError<AxiosTransactionSubmissionError>;

                    logger.error(`prepareAndSubmitCreatedTransaction (axios) for transaction ${txEnt.id} failed with: ${String(axiosError.response?.data)}`);
                    if (axiosError.response?.data.error.includes("not found")) {
                        await updateTransactionEntity(this.rootEm, txEnt.id, (txEnt) => {
                            txEnt.status = TransactionStatus.TX_CREATED;
                            txEnt.inputs.removeAll();
                            txEnt.raw = "";
                            txEnt.transactionHash = "";
                        });
                        logger.info(`Transaction ${txEnt.id} changed status to created due to invalid utxo.`);// Can this even happen?
                        if (txEnt.rbfReplacementFor) {
                            await updateTransactionEntity(this.rootEm, txEnt.rbfReplacementFor.id, (txEnt) => {
                                txEnt.inputs.removeAll();
                            });
                            logger.info(`Original transaction ${txEnt.rbfReplacementFor.id} was cleared due to invalid utxo.`);
                        }
                    }
                } else {
                    logger.error(`prepareAndSubmitCreatedTransaction for transaction ${txEnt.id} failed with: ${errorMessage(error)}`);
                }
            }
        }
    }

    async checkSubmittedTransaction(txEnt: TransactionEntity): Promise<void> {
        logger.info(`Submitted transaction ${txEnt.id} (${txEnt.transactionHash}) is being checked.`);
        try {
            if (!txEnt.transactionHash) {
                logger.warn(`Submitted transaction ${txEnt.id} is missing transactionHash. Recreating it.`);
                await updateTransactionEntity(this.rootEm, txEnt.id, (txEnt) => {
                    resetTransactionEntity(txEnt);
                });
                return;
            }
            const txResp = await this.blockchainAPI.getTransaction(txEnt.transactionHash, !txEnt.replaced_by && !txEnt.rbfReplacementFor);
            // success
            if (txResp.blockHash && txResp.confirmations) {
                logger.info(`Submitted transaction ${txEnt.id} has ${txResp.confirmations}. Needed ${this.enoughConfirmations}.`);

                // If account has too many UTXOs for one big delete account transaction we sequentially remove the remainder of UTXOs
                if (!this.checkIfTransactionWasFetchedFromAPI(txEnt) && txEnt.amount == null) {
                    const UTXOsLeft = await this.transactionUTXOService.filteredAndSortedMempoolUTXOs(txEnt.source)
                    if (UTXOsLeft.length > 0) {
                        await this.transactionService.createDeleteAccountTransaction(this.chainType, txEnt.source, txEnt.destination);
                    }
                }
            }
            if (txResp.blockHash && txResp.confirmations >= this.enoughConfirmations) {
                await updateTransactionEntity(this.rootEm, txEnt.id, (txEntToUpdate) => {
                    txEntToUpdate.confirmations = txResp.confirmations;
                    txEntToUpdate.status = TransactionStatus.TX_SUCCESS;
                    txEntToUpdate.reachedFinalStatusInTimestamp = toBN(getCurrentTimestampInSeconds());
                });
                logger.info(`Transaction ${txEnt.id} (${txEnt.transactionHash}) was accepted`);
                return;
            } else {
                const currentBlockHeight = await this.blockchainAPI.getCurrentBlockHeight();
                // if only one block left to submit => replace by fee
                const stillTimeToSubmit = checkIfShouldStillSubmit(this, currentBlockHeight, txEnt.executeUntilBlock, txEnt.executeUntilTimestamp);
                if (!txResp.blockHash && this.isAllowedToRBF(!stillTimeToSubmit, txEnt)) {
                    await this.tryToReplaceByFee(txEnt.id, currentBlockHeight);
                }
            }
        } catch (error) {
            /* istanbul ignore next */
            {
                let notFound = false;
                if (isORMError(error)) {
                    // We don't want to fail tx if error is caused by DB
                    logger.error(`checkSubmittedTransaction for transaction ${txEnt.id} failed with db error ${errorMessage(error)}`);
                    return;
                }
                if (axios.isAxiosError(error)) {
                    const axiosError = error as AxiosError<AxiosTransactionSubmissionError>;
                    if (String(axiosError.response?.data.error).includes("not found")) {
                        notFound = true;
                        if (txEnt.status === TransactionStatus.TX_REPLACED_PENDING) {
                            logger.info(`Submitted transaction ${txEnt.id} (${txEnt.transactionHash}) is pending replacement by ${txEnt.replaced_by?.id} (${txEnt.replaced_by?.transactionHash}).`)
                        } else if (txEnt.status === TransactionStatus.TX_SUCCESS && txEnt.rbfReplacementFor) {
                            logger.info(`Submitted transaction replacement ${txEnt.id} (${txEnt.transactionHash}) is pending confirmations by the original ${txEnt.rbfReplacementFor?.id} (${txEnt.rbfReplacementFor?.transactionHash}).`)
                        } else {
                            logger.error(`checkSubmittedTransaction for transaction ${txEnt.id} failed with: ${JSON.stringify(error.response?.data, null, 2)}`);
                        }
                    } else {
                        logger.error(`checkSubmittedTransaction for transaction ${txEnt.id} failed with: ${JSON.stringify(error.response?.data, null, 2)}`);
                    }
                } else {
                    logger.error(`checkSubmittedTransaction ${txEnt.id} (${txEnt.transactionHash}) cannot be fetched from node: ${String(error)}`);
                }

                const currentBlockHeight = await this.blockchainAPI.getCurrentBlockHeight();
                const stillTimeToSubmit = checkIfShouldStillSubmit(this, currentBlockHeight, txEnt.executeUntilBlock, txEnt.executeUntilTimestamp);

                if (notFound && this.checkIfTransactionWasFetchedFromAPI(txEnt)) {
                    await updateTransactionEntity(this.rootEm, txEnt.id, (txEntToUpdate) => {
                        txEntToUpdate.status = TransactionStatus.TX_FAILED;
                    });
                } else if (notFound && stillTimeToSubmit) {
                    await this.handleMalleableTransactions(txEnt);
                } else if (notFound && this.isAllowedToRBF(!stillTimeToSubmit, txEnt)) {
                    await this.tryToReplaceByFee(txEnt.id, currentBlockHeight);
                } else if (notFound && !stillTimeToSubmit) {
                    await this.handleNotFound(txEnt);
                }
            }
        }
    }

    async handleNotFound(txEnt: TransactionEntity): Promise<void> {
        if (txEnt.status === TransactionStatus.TX_REPLACED_PENDING && txEnt.replaced_by?.status === TransactionStatus.TX_SUCCESS) {
            await updateTransactionEntity(this.rootEm, txEnt.id, (txEntToUpdate) => {
                txEntToUpdate.status = TransactionStatus.TX_REPLACED;
                txEntToUpdate.reachedFinalStatusInTimestamp = toBN(getCurrentTimestampInSeconds());
            });
            logger.info(`checkSubmittedTransaction (rbf) transaction ${txEnt.id} changed status from ${TransactionStatus.TX_REPLACED_PENDING} to ${TransactionStatus.TX_REPLACED}.`);
        }
        else if (txEnt.status === TransactionStatus.TX_SUBMITTED) {
            if (txEnt.rbfReplacementFor?.status === TransactionStatus.TX_SUCCESS) { // rbf is not found => original should be accepted
                await updateTransactionEntity(this.rootEm, txEnt.id, (txEntToUpdate) => {
                    txEntToUpdate.status = TransactionStatus.TX_FAILED;
                    txEntToUpdate.reachedFinalStatusInTimestamp = toBN(getCurrentTimestampInSeconds());
                });
                logger.info(`checkSubmittedTransaction transaction ${txEnt.id} changed status from ${TransactionStatus.TX_SUBMITTED} to ${TransactionStatus.TX_FAILED}.`);
            } else if (txEnt.ancestor) {
                // recreate transaction
                await updateTransactionEntity(this.rootEm, txEnt.id, (txEnt) => {
                    resetTransactionEntity(txEnt);
                });
                logger.info(`checkSubmittedTransaction (ancestor) transaction ${txEnt.id} changed status from ${TransactionStatus.TX_SUBMITTED} to ${TransactionStatus.TX_CREATED}.`);
            } else {
                await this.handleMalleableTransactions(txEnt);
            }
        }
    }

    async handleMalleableTransactions(txEnt: TransactionEntity): Promise<void> {
        if (txEnt.replaced_by !== undefined) {
            return;
        }

        if (this.chainType === ChainType.testDOGE || this.chainType === ChainType.DOGE) {
            logger.info(`checkSubmittedTransaction transaction ${txEnt.id} is being checked for malleability.`);
            // Handle the case that transaction hash changes (transaction malleability for non-segwit transactions)
            const tr = JSON.parse(txEnt.raw!) as UTXORawTransaction;
            const newHash = await this.blockchainAPI.findTransactionHashWithInputs(txEnt.source, tr.inputs, txEnt.submittedInBlock);

            // If transaction's hash has changed - set all descendants to be reset
            if (newHash) {
                logger.info(`checkSubmittedTransaction transaction ${txEnt.id} changed hash from ${txEnt.transactionHash} to ${newHash}`);

                const descendants = await getTransactionDescendants(this.rootEm, txEnt.id);
                await transactional(this.rootEm, async (em) => {
                    for (const descendant of descendants) {
                        descendant.ancestor = txEnt;
                    }
                    await em.persistAndFlush(descendants);
                });

                await updateTransactionEntity(this.rootEm, txEnt.id, (txEntToUpdate) => {
                    txEntToUpdate.transactionHash = newHash;
                });
            } else {
                logger.warn(`checkSubmittedTransaction transaction ${txEnt.id} not found.`);
            }
        }
    }

    async submitPreparedTransactions(txEnt: TransactionEntity): Promise<void> {
        logger.info(`Checking prepared transaction ${txEnt.id}.`);
        const core = getCore(this.chainType);
        const transaction = new core.Transaction(JSON.parse(txEnt.raw!));

        const privateKey = await this.walletKeys.getKey(txEnt.source);
        /* istanbul ignore next */
        const privateKeyForFee = txEnt.feeSource ? await this.walletKeys.getKey(txEnt.feeSource) : undefined;

        /* istanbul ignore next */
        if (!privateKey || txEnt.feeSource && !privateKeyForFee) {
            await handleMissingPrivateKey(this.rootEm, txEnt.id, "submitPreparedTransactions");
            return;
        }
        await this.signAndSubmitProcess(txEnt.id, transaction, privateKey, privateKeyForFee);
    }

    async checkPendingTransaction(txEnt: TransactionEntity): Promise<void> {
        logger.info(`Checking pending transaction ${txEnt.id}.`);
        await this.waitForTransactionToAppearInMempool(txEnt.id);
    }

    async signAndSubmitProcess(txId: number, transaction: bitcore.Transaction, privateKey: string, privateKeyForFee?: string): Promise<void> {
        logger.info(`Submitting transaction ${txId}.`);
        let signed: SignedObject = {txBlob: "", txHash: ""};
        try {
            signed = this.signTransaction(transaction, privateKey, privateKeyForFee);
            logger.info(`Transaction ${txId} is signed.`);
            const txSize = transaction._calculateVSize(false);
            await updateTransactionEntity(this.rootEm, txId, (txEnt) => {
                txEnt.transactionHash = signed.txHash;
                txEnt.size = txSize;
            });
            if (txSize >= MAX_UTXO_TX_SIZE_IN_B) {
                await failTransaction(
                    this.rootEm,
                    txId,
                    `signAndSubmitProcess: Transaction ${txId} is too big: transaction size ${txSize}, maximal allowed size ${MAX_UTXO_TX_SIZE_IN_B}.`
                );
                return;
            }
        } catch (error) {
            /* istanbul ignore next */
            {
                if (isORMError(error)) {
                    // We don't want to fail tx if error is caused by DB
                    logger.error(`signAndSubmitProcess for transaction ${txId} failed with DB error: ${errorMessage(error)}`);
                    return;
                }
                await failTransaction(this.rootEm, txId, `Cannot sign transaction ${txId}: ${errorMessage(error)}`, error as Error);
                return;
            }
        }
        // submit
        const txStatus = await this.submitTransaction(signed.txBlob, txId);
        const txEnt = await fetchTransactionEntityById(this.rootEm, txId);
        if (txStatus == TransactionStatus.TX_PENDING) {
            await updateTransactionEntity(this.rootEm, txEnt.id, (txEntToUpdate) => {
                txEntToUpdate.reachedStatusPendingInTimestamp = toBN(getCurrentTimestampInSeconds());
            });
            await this.waitForTransactionToAppearInMempool(txEnt.id);
        }
    }

    async tryToReplaceByFee(txId: number, currentBlockHeight: number): Promise<void> {
        logger.info(`Transaction ${txId} is starting replacement; currentBlockHeight: ${currentBlockHeight}`);
        const oldTx = await fetchTransactionEntityById(this.rootEm, txId);
        /* istanbul ignore next */
        if (oldTx.ancestor) {
            if (oldTx.ancestor.status === TransactionStatus.TX_REPLACED && oldTx.ancestor.replaced_by?.status === TransactionStatus.TX_SUCCESS) {
                await failTransaction(
                    this.rootEm,
                    txId,
                    `tryToReplaceByFee: Transaction ${txId} has ancestor ${oldTx.ancestor.id} with status ${oldTx.ancestor.status}.`
                );
                return;
            } else if (oldTx.ancestor.status === TransactionStatus.TX_FAILED) {
                await failTransaction(
                    this.rootEm,
                    txId,
                    `tryToReplaceByFee: Transaction ${txId} has ancestor ${oldTx.ancestor.id} with status ${oldTx.ancestor.status}.`
                );
                return;
            } else if (oldTx.ancestor.status === TransactionStatus.TX_SUCCESS) {
                logger.info(`tryToReplaceByFee: Transaction ${txId} has ancestor ${oldTx.ancestor.id} with status ${oldTx.ancestor.status}.`);
                // should be accepted eventually, but rbf is allowed
            } else {
                return;
            }
        }
        // send less as in original tx (as time for payment passed) or "delete transaction" amount
        let newValue: BN | null = null;
        if (oldTx.amount != null) {
            newValue = oldTx.isFreeUnderlyingTransaction ? oldTx.amount : getMinAmountToSend(this.chainType);
        }
        const totalFee: BN = toBN(await this.transactionFeeService.calculateTotalFeeOfDescendants(this.rootEm, oldTx)).add(oldTx.fee!); // covering conflicting txs
        logger.info(`Descendants fee ${totalFee.sub(oldTx.fee!).toNumber()}, oldTx fee ${oldTx.fee}, total fee ${totalFee}`);

        const replacementTx = await createInitialTransactionEntity(
            this.rootEm,
            this.chainType,
            oldTx.source,
            oldTx.destination,
            newValue,
            totalFee,
            oldTx.reference,
            undefined, // ignore max fee constraint, as amount to pay is way less than in original
            oldTx.executeUntilBlock,
            oldTx.executeUntilTimestamp,
            oldTx,
            undefined,// rbf only with main utxos
            undefined, // ignore max fee for fee source constraint, as amount to pay is way less than in original
            oldTx.isFreeUnderlyingTransaction
        );

        await updateTransactionEntity(this.rootEm, txId, (txEnt) => {
            txEnt.replaced_by = replacementTx;
            txEnt.status = TransactionStatus.TX_REPLACED_PENDING;
            txEnt.reachedFinalStatusInTimestamp = toBN(getCurrentTimestampInSeconds());
        });

        logger.info(`tryToReplaceByFee: Trying to RBF transaction ${txId} with ${replacementTx.id}.`);
    }

    /**
     * @param {Object} transaction
     * @param {string} privateKey
     * @param {string} privateKeyForFee
     * @returns {string} - hex string
     */
    private signTransaction(transaction: bitcore.Transaction, privateKey: string, privateKeyForFee?: string): SignedObject {
        const signedTx = privateKeyForFee ? transaction.sign(privateKey).sign(privateKeyForFee) : transaction.sign(privateKey);
        const signedAndSerialized = signedTx.toString();
        const txId = transaction.id;
        return {txBlob: signedAndSerialized, txHash: txId};
    }

    /**
     * @param {string} signedTx
     * @param txId
     */
    private async submitTransaction(signedTx: string, txId: number): Promise<TransactionStatus> {
        // check if there is still time to submit
        const transaction = await fetchTransactionEntityById(this.rootEm, txId);
        const currentBlockHeight = await this.blockchainAPI.getCurrentBlockHeight();
        const currentTimestamp = getCurrentTimestampInSeconds();
        const shouldSubmit = checkIfShouldStillSubmit(this, currentBlockHeight, transaction.executeUntilBlock, transaction.executeUntilTimestamp);
        const txEntity = await fetchTransactionEntityById(this.rootEm, txId);
        if (txEntity.rbfReplacementFor == null && !shouldSubmit) {
            const medianTime = this.feeService.getLatestMedianTime();
            await failDueToNoTimeToSubmit(this.rootEm, medianTime, currentBlockHeight, txEntity, "submitTransaction");
            return TransactionStatus.TX_FAILED;
            /* istanbul ignore next */
        } else if (!transaction.executeUntilBlock) {
            logger.warn(`Transaction ${txId} does not have 'executeUntilBlock' defined`);
        }
        try {
            const resp = await this.blockchainAPI.sendTransaction(signedTx);
            if (resp.status == 200) {
                const submittedBlockHeight = await this.blockchainAPI.getCurrentBlockHeight();
                await updateTransactionEntity(this.rootEm, txId, (txEnt) => {
                    txEnt.status = TransactionStatus.TX_PENDING;
                    txEnt.submittedInBlock = submittedBlockHeight;
                    txEnt.reachedStatusPendingInTimestamp = toBN(currentTimestamp);
                });
                return TransactionStatus.TX_PENDING;
            } else {
                await failTransaction(this.rootEm, txId, `Transaction ${txId} submission failed ${resp.status}`, new Error(String(resp.data)));
                return TransactionStatus.TX_FAILED;
            }
        } catch (error) {
            /* istanbul ignore else */
            if (isORMError(error)) {
                // We don't want to fail tx if error is caused by DB
                logger.error(`Transaction ${txId} submission failed with DB error ${errorMessage(error)}`);
                return TransactionStatus.TX_PREPARED;
            } else if (axios.isAxiosError(error)) {
                return this.transactionAPISubmissionErrorHandler(txId, error as AxiosError<AxiosTransactionSubmissionError>);
            } else {
                await failTransaction(this.rootEm, txId, `Transaction ${txId} submission failed ${errorMessage(error)}`, error as Error);
                return TransactionStatus.TX_FAILED;
            }
        }
    }

    private async waitForTransactionToAppearInMempool(txId: number): Promise<void> {
        logger.info(`Transaction ${txId} is waiting to be accepted in mempool.`);
        const txEnt = await fetchTransactionEntityById(this.rootEm, txId);
        const start = txEnt.reachedStatusPendingInTimestamp!;
        while (toBN(getCurrentTimestampInSeconds()).sub(start).ltn(MEMPOOL_WAITING_TIME)) {
            try {
                const txResp = await this.blockchainAPI.getTransaction(txEnt.transactionHash!);
                /* ignore else */
                if (txResp) {
                    await updateTransactionEntity(this.rootEm, txId, (txEnt) => {
                        txEnt.status = TransactionStatus.TX_SUBMITTED;
                        txEnt.acceptedToMempoolInTimestamp = toBN(getCurrentTimestampInSeconds());
                    });
                    logger.info(`Transaction ${txId} is accepted in mempool.`);
                    return;
                }
                await sleepMs(5000); // wait for 5s
            } catch (error) {
                /* istanbul ignore next */
                logger.warn(`Transaction ${txId} not yet seen in mempool 2: ${errorMessage(error)}`);
                await sleepMs(10000); // wait for 10s
            }
        }

        // transaction was not accepted in mempool for certain time
        const currentBlockNumber = await this.blockchainAPI.getCurrentBlockHeight();
        const shouldSubmit = checkIfShouldStillSubmit(this, currentBlockNumber, txEnt.executeUntilBlock, txEnt.executeUntilTimestamp);
        if (!shouldSubmit) {
            const medianTime = this.feeService.getLatestMedianTime();
            await failDueToNoTimeToSubmit(this.rootEm, medianTime, currentBlockNumber, txEnt, "waitForTransactionToAppearInMempool");
        }
    }

    /* istanbul ignore next */
    async transactionAPISubmissionErrorHandler(txId: number, error: AxiosError<AxiosTransactionSubmissionError>) {
        if (error.response === undefined) {
            return TransactionStatus.TX_FAILED;
        }

        const errorDescription = error.response.data.error.toLowerCase();
        const txEnt = await fetchTransactionEntityById(this.rootEm, txId);
        logger.error(`Transaction ${txId} submission failed with Axios error (${errorDescription}): ${errorMessage(error)}`);

        await updateTransactionEntity(this.rootEm, txId, txEntToUpdate => {
            txEntToUpdate.lastProcessingError = `Axios error (${errorDescription}): ${errorMessage(error)}`;
        });

        if (errorDescription.includes("too-long-mempool-chain")) {
            logger.error(`Transaction ${txId} has too-long-mempool-chain`);
            return TransactionStatus.TX_PREPARED;
        } else if (errorDescription.includes("insufficient fee")) {
            logger.error(`Transaction ${txId} submission failed because of 'insufficient fee'`);
            await handleFeeToLow(this.rootEm, txEnt);
            return TransactionStatus.TX_CREATED;
        } else if (errorDescription.includes("mempool min fee not met")) {
            logger.error(`Transaction ${txId} submission failed because of 'mempool min fee not met'`);
            await handleFeeToLow(this.rootEm, txEnt);
            return TransactionStatus.TX_CREATED;
        } else if (errorDescription.includes("min relay fee not met")) {
            logger.error(`Transaction ${txId} submission failed because of 'min relay fee not met'`);
            await handleFeeToLow(this.rootEm, txEnt);
            return TransactionStatus.TX_CREATED;
        } else if (errorDescription.includes("fee exceeds maximum configured by user")) {
            logger.error(`Transaction ${txId} submission failed because of 'Fee exceeds maximum configured by user'`);
            await handleFeeToLow(this.rootEm, txEnt);
            return TransactionStatus.TX_CREATED;
        } else if (errorDescription.includes("transaction already in block chain")) {
            logger.error(`Transaction ${txId} submission failed because of 'Transaction already in block chain'`);
            await updateTransactionEntity(this.rootEm, txId, (txEnt) => {
                txEnt.status = TransactionStatus.TX_SUCCESS;
                txEnt.reachedFinalStatusInTimestamp = toBN(getCurrentTimestampInSeconds());
            });
            return TransactionStatus.TX_SUCCESS;
        } else if (errorDescription.includes("bad-txns-in") || errorDescription.includes("missing inputs")) {
            const txEnt = await fetchTransactionEntityById(this.rootEm, txId);
            // presumably original was accepted
            if ((errorDescription.includes("bad-txns-inputs-missingorspent") || errorDescription.includes("missing inputs")) && txEnt.rbfReplacementFor) {
                logger.info(`Transaction ${txId} is rejected. Transaction ${txEnt.rbfReplacementFor.id} was accepted.`);
                await updateTransactionEntity(this.rootEm, txEnt.rbfReplacementFor.id, (txEnt) => {
                    txEnt.status = TransactionStatus.TX_SUCCESS;
                });
            }
            await updateTransactionEntity(this.rootEm, txId, (txEnt) => {
                txEnt.status = txEnt.rbfReplacementFor ? TransactionStatus.TX_FAILED : TransactionStatus.TX_CREATED;
                txEnt.inputs.removeAll();
                txEnt.raw = "";
                txEnt.transactionHash = "";
            });
            logger.info(`Transaction ${txId} changed status to ${txEnt.rbfReplacementFor ? TransactionStatus.TX_FAILED : TransactionStatus.TX_CREATED}.`);
            return TransactionStatus.TX_FAILED;
        } else {
            logger.error(`Transaction ${txId} submission failed because of ${errorDescription}, transaction is: ${txEnt.raw ?? ""}`);
        }
        return TransactionStatus.TX_PREPARED;
    }

    private checkIfTransactionWasFetchedFromAPI(txEnt: TransactionEntity) {
        return txEnt.source.includes(UNKNOWN_SOURCE) || txEnt.destination.includes(UNKNOWN_DESTINATION);
    }

    private isAllowedToRBF(noTimeToSubmit: boolean, txEnt: TransactionEntity) {  // allow only one rbf
        return noTimeToSubmit && !this.checkIfTransactionWasFetchedFromAPI(txEnt) && !txEnt.rbfReplacementFor && !txEnt.replaced_by;
    }
}
