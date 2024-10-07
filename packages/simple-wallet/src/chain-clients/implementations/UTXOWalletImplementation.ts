import axios from "axios";
import * as bitcore from "bitcore-lib";
import { checkIfFeeTooHigh, checkIfShouldStillSubmit, getCurrentTimestampInSeconds, sleepMs, stuckTransactionConstants } from "../../utils/utils";
import { toBN, toNumber } from "../../utils/bnutils";
import { ChainType } from "../../utils/constants";
import { BaseWalletConfig, IWalletKeys, SignedObject, TransactionInfo, UTXOFeeParams, WriteWalletInterface } from "../../interfaces/IWalletTransaction";

import BN from "bn.js";
import {
    checkIfIsDeleting,
    correctUTXOInconsistenciesAndFillFromMempool,
    createInitialTransactionEntity,
    createTransactionOutputEntities,
    failTransaction,
    fetchTransactionEntityById,
    getTransactionInfoById,
    handleFeeToLow,
    handleMissingPrivateKey,
    updateTransactionEntity,
} from "../../db/dbutils";
import { logger } from "../../utils/logger";
import { UTXOAccountGeneration } from "../account-generation/UTXOAccountGeneration";
import { TransactionEntity, TransactionStatus } from "../../entity/transaction";
import { SpentHeightEnum } from "../../entity/utxo";
import { BlockchainFeeService } from "../../fee-service/fee-service";
import { EntityManager } from "@mikro-orm/core";
import { checkUTXONetworkStatus, getAccountBalance, getCore, getMinAmountToSend } from "../utxo/UTXOUtils";
import { BlockchainAPIWrapper } from "../../blockchain-apis/UTXOBlockchainAPIWrapper";
import { TransactionMonitor } from "../monitoring/TransactionMonitor";
import { ServiceRepository } from "../../ServiceRepository";
import { TransactionService } from "../utxo/TransactionService";
import { TransactionUTXOService } from "../utxo/TransactionUTXOService";
import { TransactionFeeService } from "../utxo/TransactionFeeService";
import { errorMessage, isORMError, LessThanDustAmountError, NegativeFeeError, NotEnoughUTXOsError } from "../../utils/axios-error-utils";

export abstract class UTXOWalletImplementation extends UTXOAccountGeneration implements WriteWalletInterface {
    inTestnet: boolean;
    rootEm!: EntityManager;
    transactionFeeService: TransactionFeeService;
    transactionService: TransactionService;
    transactionUTXOService: TransactionUTXOService;
    blockchainAPI: BlockchainAPIWrapper;
    walletKeys!: IWalletKeys;
    blockOffset: number;
    feeIncrease: number;
    executionBlockOffset: number;
    feeService: BlockchainFeeService;

    mempoolChainLengthLimit = 25;

    enoughConfirmations: number;
    mempoolWaitingTimeInS = 60; // 1min

    useRBFFactor = 1.4;

    private monitor: TransactionMonitor;

    constructor(public chainType: ChainType, createConfig: BaseWalletConfig) {
        super(chainType);
        this.inTestnet = createConfig.inTestnet ?? false;
        const resubmit = stuckTransactionConstants(this.chainType);

        this.blockOffset = createConfig.stuckTransactionOptions?.blockOffset ?? resubmit.blockOffset!;

        this.feeIncrease = createConfig.stuckTransactionOptions?.feeIncrease ?? resubmit.feeIncrease!;
        this.executionBlockOffset = createConfig.stuckTransactionOptions?.executionBlockOffset ?? resubmit.executionBlockOffset!;
        this.rootEm = createConfig.em;
        this.walletKeys = createConfig.walletKeys;
        this.enoughConfirmations = createConfig.enoughConfirmations ?? resubmit.enoughConfirmations!;

        ServiceRepository.register(this.chainType, EntityManager, this.rootEm);
        this.rootEm = ServiceRepository.get(this.chainType, EntityManager);

        ServiceRepository.register(this.chainType, BlockchainAPIWrapper, new BlockchainAPIWrapper(createConfig, this.chainType));
        this.blockchainAPI = ServiceRepository.get(this.chainType, BlockchainAPIWrapper);

        ServiceRepository.register(
            this.chainType,
            TransactionFeeService,
            new TransactionFeeService(this.chainType, this.feeIncrease)
        );
        this.transactionFeeService = ServiceRepository.get(this.chainType, TransactionFeeService);

        ServiceRepository.register(
            this.chainType,
            TransactionUTXOService,
            new TransactionUTXOService(this.chainType, this.mempoolChainLengthLimit, this.enoughConfirmations)
        );
        this.transactionUTXOService = ServiceRepository.get(this.chainType, TransactionUTXOService);

        ServiceRepository.register(this.chainType, TransactionService, new TransactionService(this.chainType));
        this.transactionService = ServiceRepository.get(this.chainType, TransactionService);

        ServiceRepository.register(this.chainType, BlockchainFeeService, new BlockchainFeeService(this.chainType));
        this.feeService = ServiceRepository.get(this.chainType, BlockchainFeeService);

        this.monitor = new TransactionMonitor(this.chainType, this.rootEm);
    }

    async getAccountBalance(account: string): Promise<BN> {
        return await getAccountBalance(this.chainType, account);
    }

    async getCurrentTransactionFee(params: UTXOFeeParams): Promise<BN> {
        return await this.transactionFeeService.getCurrentTransactionFee(params);
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
        executeUntilTimestamp?: BN
    ): Promise<number> {
        if (await checkIfIsDeleting(this.rootEm, source)) {
            logger.error(`Cannot receive requests. ${source} is deleting`);
            throw new Error(`Cannot receive requests. ${source} is deleting`);
        }
        const privateKey = await this.walletKeys.getKey(source);
        if (!privateKey) {
            logger.error(`Cannot prepare transaction ${source}. Missing private key.`)
            throw new Error(`Cannot prepare transaction ${source}. Missing private key.`);
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
            executeUntilTimestamp
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
            logger.error(`Cannot prepare transaction ${source}. Missing private key.`)
            throw new Error(`Cannot prepare transaction ${source}. Missing private key.`);
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
            async () => checkUTXONetworkStatus(this),
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
        logger.info(`Preparing transaction ${txEnt.id}`);
        try {
            // rbfReplacementFor is used since the RBF needs to use at least one of the UTXOs spent by the original transaction
            const rbfReplacementFor = txEnt.rbfReplacementFor ? await fetchTransactionEntityById(this.rootEm, txEnt.rbfReplacementFor.id) : undefined;
            const [transaction, dbUTXOs] = await this.transactionService.preparePaymentTransaction(
                txEnt.id,
                txEnt.source,
                txEnt.destination,
                txEnt.amount ?? null,
                txEnt.fee,
                txEnt.reference,
                rbfReplacementFor
            );
            const privateKey = await this.walletKeys.getKey(txEnt.source);

            if (!privateKey) {
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
                await this.signAndSubmitProcess(txEnt.id, privateKey, transaction);
            }
        } catch (error) {
            /* istanbul ignore next */
            {
                if (error instanceof NotEnoughUTXOsError) {
                    logger.warn(`Not enough UTXOs for transaction ${txEnt.id}, fetching them from mempool`);
                    // try to prepare again
                } else if (error instanceof LessThanDustAmountError) {
                    await failTransaction(this.rootEm, txEnt.id, error.message);
                }  else if (error instanceof NegativeFeeError) {
                    await failTransaction(this.rootEm, txEnt.id, error.message);
                } else if (axios.isAxiosError(error)) {
                    logger.error(`prepareAndSubmitCreatedTransaction (axios) for transaction ${txEnt.id} failed with:`, error.response?.data);
                    if (error.response?.data?.error?.indexOf("not found") >= 0) {
                        await updateTransactionEntity(this.rootEm, txEnt.id, (txEnt) => {
                            txEnt.status = TransactionStatus.TX_CREATED;
                            txEnt.utxos.removeAll();
                            txEnt.inputs.removeAll();
                            txEnt.outputs.removeAll();
                            txEnt.raw = "";
                            txEnt.transactionHash = "";
                        });
                        logger.info(`Transaction ${txEnt.id} changed status to created due to invalid utxo.`);
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
                    logger.error(`prepareAndSubmitCreatedTransaction for transaction ${txEnt.id} failed with:`, error);
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
            if (txResp.data.blockHash && txResp.data.confirmations) {
                logger.info(`Submitted transaction ${txEnt.id} has ${txResp.data.confirmations}. Needed ${this.enoughConfirmations}.`);
            }
            if (txResp.data.blockHash && txResp.data.confirmations >= this.enoughConfirmations) {
                await updateTransactionEntity(this.rootEm, txEnt.id, (txEntToUpdate) => {
                    txEntToUpdate.confirmations = txResp.data.confirmations;
                    txEntToUpdate.status = TransactionStatus.TX_SUCCESS;
                    txEntToUpdate.reachedFinalStatusInTimestamp = toBN(getCurrentTimestampInSeconds());
                });
                if (!this.checkIfTransactionWasFetchedFromAPI(txEnt)) {
                    await this.transactionUTXOService.updateTransactionInputSpentStatus(txEnt.id, SpentHeightEnum.SPENT);
                }
                logger.info(`Transaction ${txEnt.id} (${txEnt.transactionHash}) was accepted`);
                return;
            } else {
                const currentBlockHeight = await this.blockchainAPI.getCurrentBlockHeight();
                // if only one block left to submit => replace by fee
                const stillTimeToSubmit = checkIfShouldStillSubmit(this, currentBlockHeight, txEnt.executeUntilBlock, txEnt.executeUntilTimestamp);
                if (!this.checkIfTransactionWasFetchedFromAPI(txEnt) && !stillTimeToSubmit && !txResp.data.blockHash) {
                    await this.tryToReplaceByFee(txEnt.id, currentBlockHeight);
                }
            }
        } catch (error) {
            /* istanbul ignore next */
            {
                if (isORMError(error)) {
                    // We don't want to fail tx if error is caused by DB
                    logger.error(`checkSubmittedTransaction for transaction ${txEnt.id} failed with db error ${errorMessage(error)}`);
                    return;
                }
                if (axios.isAxiosError(error)) {
                    logger.error(`checkSubmittedTransaction for transaction ${txEnt.id} failed with: ${JSON.stringify(error.response?.data, null, 2)}`);
                } else {
                    logger.error(`checkSubmittedTransaction ${txEnt.id} (${txEnt.transactionHash}) cannot be fetched from node: ${error}`);
                }

                if (txEnt.ancestor) {
                    // tx fails and it has ancestor defined -> original ancestor was rbf-ed
                    // if ancestors rbf is accepted => recreate
                    if (!!txEnt.ancestor.replaced_by && txEnt.ancestor.replaced_by.status === TransactionStatus.TX_SUCCESS) {
                        await correctUTXOInconsistenciesAndFillFromMempool(
                            this.rootEm,
                            txEnt.source,
                            await this.blockchainAPI.getUTXOsWithoutScriptFromMempool(txEnt.source)
                        );
                        // recreate transaction
                        await updateTransactionEntity(this.rootEm, txEnt.id, (txEnt) => {
                            txEnt.status = TransactionStatus.TX_CREATED;
                            txEnt.utxos.removeAll();
                            txEnt.inputs.removeAll();
                            txEnt.outputs.removeAll();
                            txEnt.raw = "";
                            txEnt.transactionHash = "";
                            txEnt.fee = undefined;
                            txEnt.size = undefined;
                            txEnt.ancestor = null;
                            txEnt.replaced_by = null;
                            txEnt.rbfReplacementFor = null;
                        });
                        logger.info(`checkSubmittedTransaction (ancestor) transaction ${txEnt.id} changed status to ${TransactionStatus.TX_CREATED}.`);
                    }
                }
                logger.info(`checkSubmittedTransaction transaction ${txEnt.id} changed status to ${TransactionStatus.TX_CREATED}.`);
            }
        }
    }

    async submitPreparedTransactions(txEnt: TransactionEntity): Promise<void> {
        logger.info(`Checking prepared transaction ${txEnt.id}.`);
        const core = getCore(this.chainType);
        const transaction = new core.Transaction(JSON.parse(txEnt.raw!));

        const privateKey = await this.walletKeys.getKey(txEnt.source);
        if (!privateKey) {
            await handleMissingPrivateKey(this.rootEm, txEnt.id, "submitPreparedTransactions");
            return;
        }
        await this.signAndSubmitProcess(txEnt.id, privateKey, transaction);
    }

    async checkPendingTransaction(txEnt: TransactionEntity): Promise<void> {
        logger.info(`Checking pending transaction ${txEnt.id}.`);
        await this.waitForTransactionToAppearInMempool(txEnt.id);
    }

    async signAndSubmitProcess(txId: number, privateKey: string, transaction: bitcore.Transaction): Promise<void> {
        logger.info(`Submitting transaction ${txId}.`);
        let signed: SignedObject = { txBlob: "", txHash: "", txSize: undefined };
        try {
            signed = this.signTransaction(transaction, privateKey);
            logger.info(`Transaction ${txId} is signed.`);
            await updateTransactionEntity(this.rootEm, txId, (txEnt) => {
                txEnt.transactionHash = signed.txHash;
                txEnt.size = signed.txSize;
            });
        } catch (error: any) {
            /* istanbul ignore next */
            {
                if (isORMError(error)) {
                    // We don't want to fail tx if error is caused by DB
                    logger.error(`signAndSubmitProcess for transaction ${txId} failed with DB error: ${errorMessage(error)}`);
                    return;
                }
                await failTransaction(this.rootEm, txId, `Cannot sign transaction ${txId}: ${errorMessage(error)}`, error);
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
        const descendantsFee: BN = toBN(await this.transactionFeeService.calculateTotalFeeOfDescendants(this.rootEm, oldTx));
        const newFee: BN = descendantsFee; // covering conflicting txs

        const replacementTx = await createInitialTransactionEntity(
            this.rootEm,
            this.chainType,
            oldTx.source,
            oldTx.destination,
            newValue,
            newFee,
            oldTx.reference,
            oldTx.maxFee,
            oldTx.executeUntilBlock,
            oldTx.executeUntilTimestamp,
            oldTx
        );

        await updateTransactionEntity(this.rootEm, txId, (txEnt) => {
            txEnt.replaced_by = replacementTx;
            txEnt.status = TransactionStatus.TX_REPLACED;
            txEnt.reachedFinalStatusInTimestamp = toBN(getCurrentTimestampInSeconds());
        });

        logger.info(`tryToReplaceByFee: Trying to RBF transaction ${txId} with ${replacementTx.id}.`);
    }

    /**
     * @param {Object} transaction
     * @param {string} privateKey
     * @returns {string} - hex string
     */
    private signTransaction(transaction: bitcore.Transaction, privateKey: string): SignedObject {
        const signedAndSerialized = transaction.sign(privateKey).toString(); // serialize({disableLargeFees: true, disableSmallFees: true});
        const txSize = Buffer.byteLength(signedAndSerialized, "hex");
        const txId = transaction.id;
        return { txBlob: signedAndSerialized, txHash: txId, txSize: txSize };
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
                await failTransaction(this.rootEm, txId, `Transaction ${txId} submission failed ${resp.status}`, resp.data);
                await this.transactionUTXOService.updateTransactionInputSpentStatus(txId, SpentHeightEnum.UNSPENT);
                return TransactionStatus.TX_FAILED;
            }
        } catch (error: any) {
            if (isORMError(error)) {
                // We don't want to fail tx if error is caused by DB
                logger.error(`Transaction ${txId} submission failed with DB error ${errorMessage(error)}`);
                return TransactionStatus.TX_PREPARED;
            } else if (axios.isAxiosError(error)) {
                return this.transactionAPISubmissionErrorHandler(txId, error);
            } else {
                await failTransaction(this.rootEm, txId, `Transaction ${txId} submission failed ${errorMessage(error)}`, error);
                await this.transactionUTXOService.updateTransactionInputSpentStatus(txId, SpentHeightEnum.UNSPENT);
                return TransactionStatus.TX_FAILED;
            }
        }
    }

    private async waitForTransactionToAppearInMempool(txId: number): Promise<void> {
        logger.info(`Transaction ${txId} is waiting to be accepted in mempool.`);
        const txEnt = await fetchTransactionEntityById(this.rootEm, txId);
        const start = txEnt.reachedStatusPendingInTimestamp!;
        while (toBN(getCurrentTimestampInSeconds()).sub(start).ltn(this.mempoolWaitingTimeInS)) {
            try {
                const txResp = await this.blockchainAPI.getTransaction(txEnt.transactionHash!);
                if (txResp) {
                    await updateTransactionEntity(this.rootEm, txId, (txEnt) => {
                        txEnt.status = TransactionStatus.TX_SUBMITTED;
                        txEnt.acceptedToMempoolInTimestamp = toBN(getCurrentTimestampInSeconds());
                    });
                    logger.info(`Transaction ${txId} is accepted in mempool.`);
                    return;
                }
            } catch (e) {
                if (axios.isAxiosError(e)) {
                    logger.warn(`Transaction ${txId} not yet seen in mempool`, e.response?.data);
                } else {
                    logger.warn(`Transaction ${txId} not yet seen in mempool`, e);
                }
                await sleepMs(10000);
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
    async transactionAPISubmissionErrorHandler(txId: number, error: any) {
        const txEnt = await fetchTransactionEntityById(this.rootEm, txId);
        logger.error(`Transaction ${txId} submission failed with Axios error (${error.response?.data?.error}): ${errorMessage(error)}`);
        if (error.response?.data?.error?.indexOf("too-long-mempool-chain") >= 0) {
            logger.error(`Transaction ${txId} has too-long-mempool-chain`, error);
            return TransactionStatus.TX_PREPARED;
        } else if (error.response?.data?.error?.indexOf("insufficient fee") >= 0) {
            logger.error(`Transaction ${txId} submission failed because of 'insufficient fee'`);
            await handleFeeToLow(this.rootEm, txEnt);
            return TransactionStatus.TX_CREATED;
        } else if (error.response?.data?.error?.indexOf("mempool min fee not met") >= 0) {
            logger.error(`Transaction ${txId} submission failed because of 'mempool min fee not met'`);
            await handleFeeToLow(this.rootEm, txEnt);
            return TransactionStatus.TX_CREATED;
        } else if (error.response?.data?.error?.indexOf("min relay fee not met") >= 0) {
            logger.error(`Transaction ${txId} submission failed because of 'min relay fee not met'`);
            await handleFeeToLow(this.rootEm, txEnt);
            return TransactionStatus.TX_CREATED;
        } else if (error.response?.data?.error?.indexOf("Fee exceeds maximum configured by user") >= 0) {
            logger.error(`Transaction ${txId} submission failed because of 'Fee exceeds maximum configured by user'`);
            await handleFeeToLow(this.rootEm, txEnt);
            return TransactionStatus.TX_CREATED;
        } else if (error.response?.data?.error?.indexOf("Transaction already in block chain") >= 0) {
            logger.error(`Transaction ${txId} submission failed because of 'Transaction already in block chain'`);
            await updateTransactionEntity(this.rootEm, txId, (txEnt) => {
                txEnt.status = TransactionStatus.TX_SUCCESS;
                txEnt.reachedFinalStatusInTimestamp = toBN(getCurrentTimestampInSeconds());
            });
            return TransactionStatus.TX_SUCCESS;
        } else if (error.response?.data?.error?.indexOf("bad-txns-inputs-") >= 0) {
            const txEnt = await fetchTransactionEntityById(this.rootEm, txId);
            // presumably original was accepted
            if (error.response?.data?.error?.indexOf("bad-txns-inputs-missingorspent") >= 0 && txEnt.rbfReplacementFor) {
                logger.info(`Transaction ${txId} is rejected. Transaction ${txEnt.rbfReplacementFor.id} was accepted.`);
                await updateTransactionEntity(this.rootEm, txEnt.rbfReplacementFor.id, (txEnt) => {
                    txEnt.status = TransactionStatus.TX_SUCCESS;
                });
            }
            const mempoolUTXO = await this.blockchainAPI.getUTXOsWithoutScriptFromMempool(txEnt.source);
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
