import axios, {AxiosError} from "axios";
import * as bitcore from "bitcore-lib";
import {
    checkIfFeeTooHigh,
    checkIfShouldStillSubmit,
    createMonitoringId,
    getCurrentTimestampInSeconds,
    sleepMs,
    stuckTransactionConstants,
} from "../../utils/utils";
import {toBN, toNumber} from "../../utils/bnutils";
import {ChainType, MAX_UTXO_TX_SIZE_IN_B, MEMPOOL_WAITING_TIME} from "../../utils/constants";
import {
    BaseWalletConfig,
    IWalletKeys,
    SignedObject,
    TransactionInfo,
    UTXOFeeParams,
    WriteWalletInterface,
} from "../../interfaces/IWalletTransaction";

import BN from "bn.js";
import {
    checkIfIsDeleting,
    correctUTXOInconsistenciesAndFillFromMempool,
    countTransactionsWithStatuses,
    createInitialTransactionEntity,
    createTransactionOutputEntities,
    failTransaction,
    fetchTransactionEntityById,
    getTransactionInfoById,
    handleFeeToLow,
    handleMissingPrivateKey,
    resetTransactionEntity,
    updateTransactionEntity,
} from "../../db/dbutils";
import {logger} from "../../utils/logger";
import {UTXOAccountGeneration} from "../account-generation/UTXOAccountGeneration";
import {TransactionEntity, TransactionStatus} from "../../entity/transaction";
import {SpentHeightEnum} from "../../entity/utxo";
import {BlockchainFeeService} from "../../fee-service/fee-service";
import {EntityManager, IDatabaseDriver} from "@mikro-orm/core";
import {
    checkUTXONetworkStatus,
    getAccountBalance,
    getCore,
    getMinAmountToSend,
    getTransactionDescendants,
} from "../utxo/UTXOUtils";
import {TransactionMonitor} from "../monitoring/TransactionMonitor";
import {ServiceRepository} from "../../ServiceRepository";
import {TransactionService} from "../utxo/TransactionService";
import {TransactionUTXOService} from "../utxo/TransactionUTXOService";
import {TransactionFeeService} from "../utxo/TransactionFeeService";
import {
    errorMessage,
    isORMError,
    LessThanDustAmountError,
    NegativeFeeError,
    NotEnoughUTXOsError,
} from "../../utils/axios-utils";
import {AxiosTransactionSubmissionError, UTXORawTransaction} from "../../interfaces/IBlockchainAPI";
import {UTXOBlockchainAPI} from "../../blockchain-apis/UTXOBlockchainAPI";

export abstract class UTXOWalletImplementation extends UTXOAccountGeneration implements WriteWalletInterface {
    inTestnet: boolean;
    rootEm!: EntityManager;
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

    useRBFFactor = 1.4;

    monitoringId: string;
    private monitor: TransactionMonitor;

    constructor(public chainType: ChainType, createConfig: BaseWalletConfig) {
        super(chainType);
        this.monitoringId = createMonitoringId(this.chainType);
        this.inTestnet = createConfig.inTestnet ?? false;
        const resubmit = stuckTransactionConstants(this.chainType);

        this.blockOffset = createConfig.stuckTransactionOptions?.blockOffset ?? resubmit.blockOffset!;

        this.feeIncrease = createConfig.stuckTransactionOptions?.feeIncrease ?? resubmit.feeIncrease!;
        this.executionBlockOffset = createConfig.stuckTransactionOptions?.executionBlockOffset ?? resubmit.executionBlockOffset!;
        this.rootEm = createConfig.em;
        this.walletKeys = createConfig.walletKeys;
        this.enoughConfirmations = createConfig.enoughConfirmations ?? resubmit.enoughConfirmations!;

        ServiceRepository.register(this.chainType, EntityManager<IDatabaseDriver>, this.rootEm);
        this.rootEm = ServiceRepository.get(this.chainType, EntityManager<IDatabaseDriver>);

        ServiceRepository.register(this.chainType, UTXOBlockchainAPI, new UTXOBlockchainAPI(createConfig, this.chainType));
        this.blockchainAPI = ServiceRepository.get(this.chainType, UTXOBlockchainAPI);

        ServiceRepository.register(
            this.chainType,
            TransactionFeeService,
            new TransactionFeeService(this.chainType, this.feeIncrease)
        );
        this.transactionFeeService = ServiceRepository.get(this.chainType, TransactionFeeService);

        ServiceRepository.register(
            this.chainType,
            TransactionUTXOService,
            new TransactionUTXOService(this.chainType, this.enoughConfirmations)
        );
        this.transactionUTXOService = ServiceRepository.get(this.chainType, TransactionUTXOService);

        ServiceRepository.register(this.chainType, TransactionService, new TransactionService(this.chainType));
        this.transactionService = ServiceRepository.get(this.chainType, TransactionService);

        ServiceRepository.register(this.chainType, BlockchainFeeService, new BlockchainFeeService(this.chainType, this.monitoringId));
        this.feeService = ServiceRepository.get(this.chainType, BlockchainFeeService);

        this.monitor = new TransactionMonitor(this.chainType, this.rootEm, this.monitoringId);
    }

    getMonitoringId(): string {
        return this.monitoringId;
    }

    async getAccountBalance(account: string): Promise<BN> {
        return await getAccountBalance(this.chainType, account);
    }

    /**
     * @param {UTXOFeeParams} params - basic data needed to estimate fee
     * @returns {BN} - current transaction/network fee in satoshis
     */
    async getCurrentTransactionFee(params: UTXOFeeParams): Promise<BN> {

        try {
            const utxosFromMempool = await this.blockchainAPI.getUTXOsFromMempool(params.source);
            await correctUTXOInconsistenciesAndFillFromMempool(this.rootEm, params.source, utxosFromMempool);
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
     * @param feeSource - address of the wallet which is used for paying transaction fees
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
        feeSource?: string
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
            feeSource
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
        if (await checkIfIsDeleting(this.rootEm, source)) {
            logger.error(`Cannot receive requests. ${source} is deleting`);
            throw new Error(`Cannot receive requests. ${source} is deleting`);
        }
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
    async startMonitoringTransactionProgress(): Promise<void> {
        await this.monitor.startMonitoringTransactionProgress(
            this.submitPreparedTransactions.bind(this),
            this.checkPendingTransaction.bind(this),
            this.prepareAndSubmitCreatedTransaction.bind(this),
            this.checkSubmittedTransaction.bind(this),
            async () => checkUTXONetworkStatus(this)
        );
    }

    async isMonitoring(): Promise<boolean> {
        return await this.monitor.isMonitoring();
    }

    async stopMonitoring(): Promise<void> {
        await this.monitor.stopMonitoring();
    }

    ///////////////////////////////////////////////////////////////////////////////////////
    // HELPER OR CLIENT SPECIFIC FUNCTIONS ////////////////////////////////////////////////
    ///////////////////////////////////////////////////////////////////////////////////////
    async prepareAndSubmitCreatedTransaction(txEnt: TransactionEntity): Promise<void> {
        const currentBlockNumber = await this.blockchainAPI.getCurrentBlockHeight();
        const currentTimestamp = getCurrentTimestampInSeconds();
        const shouldSubmit = checkIfShouldStillSubmit(this, currentBlockNumber, txEnt.executeUntilBlock, txEnt.executeUntilTimestamp);
        if (txEnt.rbfReplacementFor == null && !shouldSubmit) {
            await failTransaction(
                this.rootEm,
                txEnt.id,
                `prepareAndSubmitCreatedTransaction: Both conditions met for transaction ${txEnt.id}: Current ledger ${currentBlockNumber} >= last transaction ledger ${txEnt.executeUntilBlock} AND Current timestamp ${currentTimestamp} >= execute until timestamp ${txEnt.executeUntilTimestamp?.toString()}`
            );
            return;
        } else if (!txEnt.executeUntilBlock && !txEnt.executeUntilTimestamp) {
            await updateTransactionEntity(this.rootEm, txEnt.id, (txEnt) => {
                txEnt.executeUntilBlock = currentBlockNumber + this.blockOffset;
            });
        }
        // If the transaction is for deleting account we should check that all transactions going from it finish
        if (txEnt.amount === null) {
            const balanceResp = await this.blockchainAPI.getAccountBalance(txEnt.source);
            const numTxs = await countTransactionsWithStatuses(this.rootEm, this.chainType, [TransactionStatus.TX_SUBMITTED, TransactionStatus.TX_PREPARED, TransactionStatus.TX_CREATED], txEnt.source);
            if (numTxs > 1) { // > 1 since it already has 1 tx which is delete acc tx
                logger.info(`Account ${txEnt.source} can't be deleted because it has unfinished transactions.`);
                return;
            }
            if (balanceResp && balanceResp.unconfirmedTxs > 0 || balanceResp?.unconfirmedBalance != 0) {
                logger.info(`Account ${txEnt.source} can't be deleted because it has unfinished transactions.`);
                return;
            }
        }
        logger.info(`Preparing transaction ${txEnt.id}`);
        try {
            // rbfReplacementFor is used since the RBF needs to use at least one of the UTXOs spent by the original transaction
            const utxosFromMempool = await this.blockchainAPI.getUTXOsFromMempool(txEnt.source);
            await correctUTXOInconsistenciesAndFillFromMempool(this.rootEm, txEnt.source, utxosFromMempool);

            if (txEnt.feeSource) {
                const utxosFromMempool = await this.blockchainAPI.getUTXOsFromMempool(txEnt.feeSource);
                await correctUTXOInconsistenciesAndFillFromMempool(this.rootEm, txEnt.feeSource, utxosFromMempool);
            }

            const rbfReplacementFor = txEnt.rbfReplacementFor ? await fetchTransactionEntityById(this.rootEm, txEnt.rbfReplacementFor.id) : undefined;
            const [transaction, dbUTXOs] = await this.transactionService.preparePaymentTransaction(
                txEnt.id,
                txEnt.source,
                txEnt.destination,
                txEnt.amount ?? null,
                txEnt.fee,
                txEnt.reference,
                rbfReplacementFor,
                txEnt.feeSource,
            );
            const privateKey = await this.walletKeys.getKey(txEnt.source);
            const privateKeyForFee = txEnt.feeSource ? await this.walletKeys.getKey(txEnt.feeSource) : undefined;

            /* istanbul ignore next */
            if (!privateKey || txEnt.feeSource && !privateKeyForFee) {
                await handleMissingPrivateKey(this.rootEm, txEnt.id, "prepareAndSubmitCreatedTransaction");
                return;
            }

            if (checkIfFeeTooHigh(toBN(transaction.getFee()), txEnt.maxFee ?? null)) {
                if (rbfReplacementFor) {
                    transaction.fee(toNumber(txEnt.maxFee!));
                } else {
                    await failTransaction(this.rootEm, txEnt.id, `Fee restriction (fee: ${transaction.getFee()}, maxFee: ${txEnt.maxFee?.toString()})`);
                    return;
                }
            } else {
                const inputs = await this.transactionUTXOService.createInputsFromUTXOs(dbUTXOs, txEnt.id);
                const outputs = await createTransactionOutputEntities(this.rootEm, transaction, txEnt.id);
                await updateTransactionEntity(this.rootEm, txEnt.id, (txEntToUpdate) => {
                    txEntToUpdate.raw = JSON.stringify(transaction);
                    txEntToUpdate.status = TransactionStatus.TX_PREPARED;
                    txEntToUpdate.reachedStatusPreparedInTimestamp = toBN(getCurrentTimestampInSeconds());
                    txEntToUpdate.fee = toBN(transaction.getFee()); // set the new fee if the original one was null/wrong
                    txEntToUpdate.utxos.set(dbUTXOs);
                    txEntToUpdate.inputs.add(inputs);
                    txEntToUpdate.outputs.add(outputs);
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
                } else if (axios.isAxiosError(error)) {
                    const axiosError = error as AxiosError<AxiosTransactionSubmissionError>;

                    logger.error(`prepareAndSubmitCreatedTransaction (axios) for transaction ${txEnt.id} failed with: ${String(axiosError.response?.data)}`);
                    if (axiosError.response?.data.error.includes("not found")) {
                        await updateTransactionEntity(this.rootEm, txEnt.id, (txEnt) => {
                            txEnt.status = TransactionStatus.TX_CREATED;
                            txEnt.utxos.removeAll();
                            txEnt.inputs.removeAll();
                            txEnt.outputs.removeAll();
                            txEnt.raw = "";
                            txEnt.transactionHash = "";
                        });
                        logger.info(`Transaction ${txEnt.id} changed status to created due to invalid utxo.`);//TODO can this even happen?
                        if (txEnt.rbfReplacementFor) {
                            await updateTransactionEntity(this.rootEm, txEnt.rbfReplacementFor.id, (txEnt) => {
                                txEnt.utxos.removeAll();
                                txEnt.inputs.removeAll();
                                txEnt.outputs.removeAll();
                            });
                            logger.info(`Original transaction ${txEnt.rbfReplacementFor.id} was cleared due to invalid utxo.`);
                        }
                    }
                } else {
                    logger.error(`prepareAndSubmitCreatedTransaction for transaction ${txEnt.id} failed with: ${String(error)}`);
                }
            }
            return;
        }
    }

    async checkSubmittedTransaction(txEnt: TransactionEntity): Promise<void> {
        logger.info(`Submitted transaction ${txEnt.id} (${txEnt.transactionHash}) is being checked.`);
        try {
            const txResp = await this.blockchainAPI.getTransaction(txEnt.transactionHash!);
            // success
            if (txResp.blockHash && txResp.confirmations) {
                logger.info(`Submitted transaction ${txEnt.id} has ${txResp.confirmations}. Needed ${this.enoughConfirmations}.`);
            }
            if (txResp.blockHash && txResp.confirmations >= this.enoughConfirmations) {
                await updateTransactionEntity(this.rootEm, txEnt.id, (txEntToUpdate) => {
                    txEntToUpdate.confirmations = txResp.confirmations;
                    txEntToUpdate.status = TransactionStatus.TX_SUCCESS;
                    txEntToUpdate.reachedFinalStatusInTimestamp = toBN(getCurrentTimestampInSeconds());
                });

                /* istanbul ignore next */
                if (!this.checkIfTransactionWasFetchedFromAPI(txEnt)) {
                    await this.transactionUTXOService.updateTransactionInputSpentStatus(txEnt.id, SpentHeightEnum.SPENT);
                }
                logger.info(`Transaction ${txEnt.id} (${txEnt.transactionHash}) was accepted`);
                return;
            } else {
                const currentBlockHeight = await this.blockchainAPI.getCurrentBlockHeight();
                // if only one block left to submit => replace by fee
                const stillTimeToSubmit = checkIfShouldStillSubmit(this, currentBlockHeight, txEnt.executeUntilBlock, txEnt.executeUntilTimestamp);
                if (!this.checkIfTransactionWasFetchedFromAPI(txEnt) && !stillTimeToSubmit && !txResp.blockHash && !txEnt.replaced_by) { // allow only one rbf
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
                    logger.error(`checkSubmittedTransaction for transaction ${txEnt.id} failed with: ${JSON.stringify(error.response?.data, null, 2)}`);
                    if (String(axiosError.response?.data.error).includes("not found")) {
                        notFound = true;
                    }
                } else {
                    logger.error(`checkSubmittedTransaction ${txEnt.id} (${txEnt.transactionHash}) cannot be fetched from node: ${String(error)}`);
                }

                if (notFound) {
                    await this.handleNotFound(txEnt);
                }
            }
        }
    }

    async handleNotFound(txEnt: TransactionEntity): Promise<void> {
        if (txEnt.status === TransactionStatus.TX_REPLACED_PENDING) {
            await updateTransactionEntity(this.rootEm, txEnt.id, (txEntToUpdate) => {
                txEntToUpdate.status = TransactionStatus.TX_REPLACED;
                txEntToUpdate.reachedFinalStatusInTimestamp = toBN(getCurrentTimestampInSeconds());
            });
            logger.info(`checkSubmittedTransaction (rbf) transaction ${txEnt.id} changed status from ${TransactionStatus.TX_REPLACED_PENDING} to ${TransactionStatus.TX_CREATED}.`);
        }
        if (txEnt.status === TransactionStatus.TX_SUBMITTED) { // TODO - legit tx 2904 - 3c5bd7395b3ee8e0c503e48044d029b760a9a0c08e9e78e66ec355b73c9a961b was marked as not found!!!
            if (txEnt.rbfReplacementFor) { // rbf is not found => original should be accepted
                await updateTransactionEntity(this.rootEm, txEnt.id, (txEntToUpdate) => {
                    txEntToUpdate.status = TransactionStatus.TX_FAILED;
                    txEntToUpdate.reachedFinalStatusInTimestamp = toBN(getCurrentTimestampInSeconds());
                });
                logger.info(`checkSubmittedTransaction transaction ${txEnt.id} changed status from ${TransactionStatus.TX_SUBMITTED} to ${TransactionStatus.TX_FAILED}.`);
            } else if (txEnt.ancestor) {
                await correctUTXOInconsistenciesAndFillFromMempool(
                    this.rootEm,
                    txEnt.source,
                    await this.blockchainAPI.getUTXOsFromMempool(txEnt.source),
                );
                // recreate transaction
                await updateTransactionEntity(this.rootEm, txEnt.id, (txEnt) => {
                    resetTransactionEntity(txEnt);
                });
                logger.info(`checkSubmittedTransaction (ancestor) transaction ${txEnt.id} changed status from ${TransactionStatus.TX_SUBMITTED} to ${TransactionStatus.TX_CREATED}.`);
            } else {
                // Handle the case that transaction hash changes (transaction malleability for non-segwit transactions)
                const tr = JSON.parse(txEnt.raw!) as UTXORawTransaction;
                const newHash = await this.blockchainAPI.findTransactionHashWithInputs(txEnt.source, tr.inputs, txEnt.submittedInBlock);

                // If transaction's hash has changed - set all descendants to be reset
                if (newHash) {
                    logger.info(`checkSubmittedTransaction transaction ${txEnt.id} changed hash from ${txEnt.transactionHash} to ${newHash}`);

                    const descendants = await getTransactionDescendants(this.rootEm, txEnt.transactionHash!, txEnt.source);
                    await this.rootEm.transactional(async (em) => {
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
        /* istanbul ignore next */
        if (await this.transactionUTXOService.checkIfTxUsesAlreadySpentUTXOs(txId)) {
            return;
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
        // send minimal amount (as time for payment passed) or "delete transaction" amount
        const newValue: BN | null = oldTx.amount == null ? null : getMinAmountToSend(this.chainType);
        const descendantsFee: BN = toBN(await this.transactionFeeService.calculateTotalFeeOfDescendants(this.rootEm, oldTx)); // covering conflicting txs
        const replacementTx = await createInitialTransactionEntity(
            this.rootEm,
            this.chainType,
            oldTx.source,
            oldTx.destination,
            newValue,
            descendantsFee,
            oldTx.reference,
            oldTx.maxFee,
            oldTx.executeUntilBlock,
            oldTx.executeUntilTimestamp,
            oldTx,
            oldTx.feeSource
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
            await failTransaction(
                this.rootEm,
                txId,
                `Transaction ${txId} has no time left to be submitted: currentBlockHeight: ${currentBlockHeight}, executeUntilBlock: ${transaction.executeUntilBlock}, offset ${this.executionBlockOffset}.
                Current timestamp ${currentTimestamp} >= execute until timestamp ${transaction.executeUntilTimestamp?.toString()}.`
            );
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
                await this.transactionUTXOService.updateTransactionInputSpentStatus(txId, SpentHeightEnum.SENT);
                return TransactionStatus.TX_PENDING;
            } else {
                await failTransaction(this.rootEm, txId, `Transaction ${txId} submission failed ${resp.status}`, new Error(String(resp.data)));
                await this.transactionUTXOService.updateTransactionInputSpentStatus(txId, SpentHeightEnum.UNSPENT);
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
                await this.transactionUTXOService.updateTransactionInputSpentStatus(txId, SpentHeightEnum.UNSPENT);
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
            } catch (e) {
                /* istanbul ignore next */
                if (axios.isAxiosError(e)) {
                    logger.warn(`Transaction ${txId} not yet seen in mempool`, e.response?.data);
                } else {
                    logger.warn(`Transaction ${txId} not yet seen in mempool`, e);
                }
                await sleepMs(10000); // wait for 10s
            }
        }

        // transaction was not accepted in mempool by one minute
        const currentBlockNumber = await this.blockchainAPI.getCurrentBlockHeight();
        const shouldSubmit = checkIfShouldStillSubmit(this, currentBlockNumber, txEnt.executeUntilBlock, txEnt.executeUntilTimestamp);
        if (!shouldSubmit) {
            await failTransaction(
                this.rootEm,
                txId,
                `waitForTransactionToAppearInMempool: Current ledger ${currentBlockNumber} >= last transaction ledger ${txEnt.executeUntilBlock}`
            );
        }
    }

    /* istanbul ignore next */
    async transactionAPISubmissionErrorHandler(txId: number, error: AxiosError<AxiosTransactionSubmissionError>) {
        if (error.response === undefined) {
            return TransactionStatus.TX_FAILED;
        }

        const errorDescription = error.response.data.error;
        const txEnt = await fetchTransactionEntityById(this.rootEm, txId);
        logger.error(`Transaction ${txId} submission failed with Axios error (${errorDescription}): ${errorMessage(error)}`);

        if (errorDescription.includes("too-long-mempool-chain")) {
            logger.error(`Transaction ${txId} has too-long-mempool-chain`, error);
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
        } else if (errorDescription.includes("Fee exceeds maximum configured by user")) {
            logger.error(`Transaction ${txId} submission failed because of 'Fee exceeds maximum configured by user'`);
            await handleFeeToLow(this.rootEm, txEnt);
            return TransactionStatus.TX_CREATED;
        } else if (errorDescription.includes("Transaction already in block chain")) {
            logger.error(`Transaction ${txId} submission failed because of 'Transaction already in block chain'`);
            await updateTransactionEntity(this.rootEm, txId, (txEnt) => {
                txEnt.status = TransactionStatus.TX_SUCCESS;
                txEnt.reachedFinalStatusInTimestamp = toBN(getCurrentTimestampInSeconds());
            });
            return TransactionStatus.TX_SUCCESS;
        } else if (errorDescription.includes("bad-txns-inputs-")) {
            const txEnt = await fetchTransactionEntityById(this.rootEm, txId);
            // presumably original was accepted
            if (errorDescription.includes("bad-txns-inputs-missingorspent") && txEnt.rbfReplacementFor) {
                logger.info(`Transaction ${txId} is rejected. Transaction ${txEnt.rbfReplacementFor.id} was accepted.`);
                await updateTransactionEntity(this.rootEm, txEnt.rbfReplacementFor.id, (txEnt) => {
                    txEnt.status = TransactionStatus.TX_SUCCESS;
                });
            }
            const mempoolUTXO = await this.blockchainAPI.getUTXOsFromMempool(txEnt.source);
            await correctUTXOInconsistenciesAndFillFromMempool(this.rootEm, txEnt.source, mempoolUTXO);
            await updateTransactionEntity(this.rootEm, txId, (txEnt) => {
                txEnt.status = txEnt.rbfReplacementFor ? TransactionStatus.TX_FAILED : TransactionStatus.TX_CREATED;
                txEnt.utxos.removeAll();
                txEnt.inputs.removeAll();
                txEnt.outputs.removeAll();
                txEnt.raw = "";
                txEnt.transactionHash = "";
            });
            logger.info(`Transaction ${txId} changed status to ${txEnt.rbfReplacementFor ? TransactionStatus.TX_FAILED : TransactionStatus.TX_CREATED}.`);
            return TransactionStatus.TX_FAILED;
        }
        return TransactionStatus.TX_PREPARED;
    }

    checkIfTransactionWasFetchedFromAPI(txEnt: TransactionEntity) {
        return txEnt.source.includes("FETCHED_VIA_API_UNKNOWN_SOURCE") || txEnt.destination.includes("FETCHED_VIA_API_UNKNOWN_DESTINATION");
    }
}
