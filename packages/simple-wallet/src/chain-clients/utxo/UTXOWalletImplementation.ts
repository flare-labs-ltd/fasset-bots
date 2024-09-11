import axios from "axios";
import * as bitcore from "bitcore-lib";
import { checkIfFeeTooHigh, checkIfShouldStillSubmit, getCurrentTimestampInSeconds, sleepMs, stuckTransactionConstants } from "../../utils/utils";
import { toBN, toNumber } from "../../utils/bnutils";
import { ChainType } from "../../utils/constants";
import {
    BaseWalletConfig,
    IWalletKeys,
    SignedObject,
    TransactionInfo, UTXOFeeParams,
    WriteWalletInterface,
} from "../../interfaces/IWalletTransaction";
// eslint-disable-next-line @typescript-eslint/no-var-requires
import BN from "bn.js";
import {
    correctUTXOInconsistencies,
    createInitialTransactionEntity,
    createTransactionOutputEntities,
    failTransaction,
    fetchTransactionEntityById,
    getTransactionInfoById,
    handleMissingPrivateKey,
    removeUTXOsAndAddReplacement,
    updateTransactionEntity,
} from "../../db/dbutils";
import { logger } from "../../utils/logger";
import { UTXOAccountGeneration } from "../account-generation/UTXOAccountGeneration";
import { TransactionEntity, TransactionStatus } from "../../entity/transaction";
import { SpentHeightEnum } from "../../entity/utxo";
import { BlockchainFeeService } from "../../fee-service/service";
import { EntityManager } from "@mikro-orm/core";
import {
    checkUTXONetworkStatus,
    getAccountBalance,
    getCore,
    getMinAmountToSend,
    getTransactionDescendants,
} from "./UTXOUtils";
import { BlockchainAPIWrapper } from "../../blockchain-apis/BlockchainAPIWrapper";
import { TransactionMonitor } from "../monitoring/TransactionMonitor";
import { ServiceRepository } from "../../ServiceRepository";
import { TransactionService } from "./TransactionService";
import { TransactionUTXOService } from "./TransactionUTXOService";
import { TransactionFeeService } from "./TransactionFeeService";
import { errorMessage, InvalidFeeError, isORMError, LessThanDustAmountError, NotEnoughUTXOsError } from "../../utils/axios-error-utils";
import { BlockData } from "../../interfaces/IBlockchainAPI";

export abstract class UTXOWalletImplementation extends UTXOAccountGeneration implements WriteWalletInterface {
    inTestnet: boolean;
    rootEm!: EntityManager;
    walletKeys!: IWalletKeys;
    blockOffset: number;
    feeIncrease: number;
    relayFeePerB: number = 1;
    executionBlockOffset: number;
    feeDecileIndex: number = 8; // 8-th decile
    feeService?: BlockchainFeeService;
    blockchainAPI: BlockchainAPIWrapper;
    mempoolChainLengthLimit: number = 25;

    enoughConfirmations: number;
    mempoolWaitingTimeInS: number = 60; // 1min

    useRBFFactor = 1.5;

    private monitor: TransactionMonitor;

    constructor(public chainType: ChainType, createConfig: BaseWalletConfig) {
        super(chainType);
        this.inTestnet = createConfig.inTestnet ?? false;
        this.blockchainAPI = new BlockchainAPIWrapper(createConfig, this.chainType);
        const resubmit = stuckTransactionConstants(this.chainType);
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        this.blockOffset = createConfig.stuckTransactionOptions?.blockOffset ?? resubmit.blockOffset!;
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        this.feeIncrease = createConfig.stuckTransactionOptions?.feeIncrease ?? resubmit.feeIncrease!;
        this.relayFeePerB = createConfig.relayFeePerB ?? this.relayFeePerB;
        this.executionBlockOffset = createConfig.stuckTransactionOptions?.executionBlockOffset ?? resubmit.executionBlockOffset!;
        this.rootEm = createConfig.em;
        this.walletKeys = createConfig.walletKeys;
        this.enoughConfirmations = createConfig.enoughConfirmations ?? resubmit.enoughConfirmations!;
        this.feeDecileIndex = createConfig.feeDecileIndex ?? this.feeDecileIndex;
        if (createConfig.feeServiceConfig) {
            this.feeService = new BlockchainFeeService(createConfig.feeServiceConfig);
        }
        this.monitor = new TransactionMonitor(this.chainType, this.rootEm);

        ServiceRepository.register(EntityManager, this.rootEm);

        ServiceRepository.register(TransactionFeeService, new TransactionFeeService(this.chainType, this.feeDecileIndex, this.feeIncrease, this.relayFeePerB));
        ServiceRepository.register(TransactionUTXOService, new TransactionUTXOService(this.chainType, this.mempoolChainLengthLimit, this.enoughConfirmations));
        ServiceRepository.register(TransactionService, new TransactionService(this.chainType));
        ServiceRepository.register(BlockchainAPIWrapper, new BlockchainAPIWrapper(createConfig, this.chainType));

        if (createConfig.feeServiceConfig) {
            ServiceRepository.register(BlockchainFeeService, new BlockchainFeeService(createConfig.feeServiceConfig));
        }
    }

    async getAccountBalance(account: string, otherAddresses?: string[]): Promise<BN> {
        return await getAccountBalance(account, otherAddresses);
    }

    async getCurrentTransactionFee(params: UTXOFeeParams): Promise<BN> {
        return await ServiceRepository.get(TransactionFeeService).getCurrentTransactionFee(params);
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
     * @param {string} privateKey
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
        privateKey: string,
        destination: string,
        amountInSatoshi: BN | null,
        feeInSatoshi?: BN,
        note?: string,
        maxFeeInSatoshi?: BN,
        executeUntilBlock?: number,
        executeUntilTimestamp?: BN,
    ): Promise<number> {
        await this.walletKeys.addKey(source, privateKey);
        return ServiceRepository.get(TransactionService).createPaymentTransaction(this.chainType, source, destination, amountInSatoshi, feeInSatoshi, note, maxFeeInSatoshi, executeUntilBlock, executeUntilTimestamp);
    }

    /**
     * @param {string} source
     * @param {string} privateKey
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
        privateKey: string,
        destination: string,
        feeInSatoshi?: BN,
        note?: string,
        maxFeeInSatoshi?: BN,
        executeUntilBlock?: number,
        executeUntilTimestamp?: BN,
    ): Promise<number> {
        await this.walletKeys.addKey(source, privateKey);
        return ServiceRepository.get(TransactionService).createDeleteAccountTransaction(this.chainType, source, destination, feeInSatoshi, note, maxFeeInSatoshi, executeUntilBlock, executeUntilTimestamp);
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
        const currentBlock = await ServiceRepository.get(BlockchainAPIWrapper).getCurrentBlockHeight();
        const currentTimestamp = getCurrentTimestampInSeconds();
        const shouldSubmit = await checkIfShouldStillSubmit(this, currentBlock.number, txEnt.executeUntilBlock, txEnt.executeUntilTimestamp);
        if (txEnt.rbfReplacementFor == null && !shouldSubmit) {
            await failTransaction(
                this.rootEm, txEnt.id,
                `prepareAndSubmitCreatedTransaction: Both conditions met for transaction ${txEnt.id}: Current ledger ${currentBlock.number} >= last transaction ledger ${txEnt.executeUntilBlock} AND Current timestamp ${currentTimestamp} >= execute until timestamp ${txEnt.executeUntilTimestamp}`);
            return;
        } else if (!txEnt.executeUntilBlock) {
            await updateTransactionEntity(this.rootEm, txEnt.id, async (txEnt) => {
                txEnt.executeUntilBlock = currentBlock.number + this.blockOffset;
            });
        }
        logger.info(`Preparing transaction ${txEnt.id}`);
        // TODO: determine how often this should be run - if there will be lots of UTXOs api fetches and updates can become too slow (but do we want to risk inconsistency?)
        await correctUTXOInconsistencies(this.rootEm, txEnt.source, await ServiceRepository.get(BlockchainAPIWrapper).getUTXOsWithoutScriptFromMempool(txEnt.source, this.chainType));

        try {
            // rbfReplacementFor is used since the RBF needs to use at least of the UTXOs spent by the original transaction
            const rbfReplacementFor = txEnt.rbfReplacementFor ? await fetchTransactionEntityById(this.rootEm, txEnt.rbfReplacementFor.id) : undefined;
            const [transaction, dbUTXOs] = await ServiceRepository.get(TransactionService).preparePaymentTransaction(txEnt.id, txEnt.source, txEnt.destination, txEnt.amount || null, txEnt.fee, txEnt.reference, rbfReplacementFor);
            const privateKey = await this.walletKeys.getKey(txEnt.source);

            if (!privateKey) {
                await handleMissingPrivateKey(this.rootEm, txEnt.id);
                return;
            }
            if (checkIfFeeTooHigh(toBN(transaction.getFee()), txEnt.maxFee || null)) {
                if (rbfReplacementFor) {
                    transaction.fee(toNumber(txEnt.maxFee!))
                }
                await failTransaction(this.rootEm, txEnt.id, `Fee restriction (fee: ${transaction.getFee()}, maxFee: ${txEnt.maxFee?.toString()})`);
            } else {
                const inputs = await ServiceRepository.get(TransactionUTXOService).createInputsFromUTXOs(dbUTXOs, txEnt.id);
                const outputs = await createTransactionOutputEntities(this.rootEm, transaction, txEnt.id);
                await updateTransactionEntity(this.rootEm, txEnt.id, async (txEntToUpdate) => {
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
            if (error instanceof InvalidFeeError) {//TODO
                logger.info(`Setting new fee for transaction ${txEnt.id} to ${error.correctFee}`);
                await updateTransactionEntity(this.rootEm, txEnt.id, async (txEntToUpdate) => {
                    txEntToUpdate.fee = error instanceof InvalidFeeError ? error.correctFee : txEntToUpdate.fee; // The check is needed because of the compiler
                });
            } else if (error instanceof NotEnoughUTXOsError) {
                logger.warn(`Not enough UTXOs for transaction ${txEnt.id}, fetching them from mempool`);
                await ServiceRepository.get(TransactionUTXOService).fillUTXOsFromMempool(txEnt.source);
            } else if (error instanceof LessThanDustAmountError) {
                await failTransaction(this.rootEm, txEnt.id, error.message);
            } else {
                logger.error(`prepareAndSubmitCreatedTransaction for transaction ${txEnt.id} failed with: ${errorMessage(error)}`);
            }
            return;
        }

    }

    async checkSubmittedTransaction(txEnt: TransactionEntity): Promise<void> {
        logger.info(`Submitted transaction ${txEnt.id} (${txEnt.transactionHash}) is being checked.`);
        try {
            const txResp = await ServiceRepository.get(BlockchainAPIWrapper).getTransaction(txEnt.transactionHash);
            // success
            if (txResp.data.blockHash && txResp.data.confirmations >= this.enoughConfirmations) {
                await updateTransactionEntity(this.rootEm, txEnt.id, async (txEntToUpdate) => {
                    txEntToUpdate.confirmations = txResp.data.confirmations;
                    txEntToUpdate.status = TransactionStatus.TX_SUCCESS;
                    txEntToUpdate.reachedFinalStatusInTimestamp = toBN(getCurrentTimestampInSeconds());
                });

                if (!this.checkIfTransactionWasFetchedFromAPI(txEnt)) {
                    await ServiceRepository.get(TransactionUTXOService).updateTransactionInputSpentStatus(txEnt.id, SpentHeightEnum.SPENT);
                }

                logger.info(`Transaction ${txEnt.id} (${txEnt.transactionHash}) was accepted`);
                return;
            }
        } catch (error) {
            if (!axios.isAxiosError(error) || isORMError(error)) { // We don't want to fail tx if error is caused by DB
                logger.error(`checkSubmittedTransaction for transaction ${txEnt.id} failed with ${errorMessage(error)}`);
                return;
            }
            logger.error(`Transaction ${txEnt.id} (${txEnt.transactionHash}) cannot be fetched from node: ${errorMessage(error)}`);
        }

        const currentBlockHeight = await ServiceRepository.get(BlockchainAPIWrapper).getCurrentBlockHeight();
        if (!this.checkIfTransactionWasFetchedFromAPI(txEnt) && (currentBlockHeight.number - txEnt.submittedInBlock) > (this.enoughConfirmations * this.useRBFFactor)) {//TODO - ? how long do we wait?
            await this.tryToReplaceByFee(txEnt.id, currentBlockHeight);
        }
    }

    async submitPreparedTransactions(txEnt: TransactionEntity): Promise<void> {
        logger.info(`Checking prepared transaction ${txEnt.id}.`);
        const core = getCore(this.chainType);
        const transaction = new core.Transaction(JSON.parse(txEnt.raw!));

        const privateKey = await this.walletKeys.getKey(txEnt.source);
        if (!privateKey) {
            await handleMissingPrivateKey(this.rootEm, txEnt.id);
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
        let signed = { txBlob: "", txHash: "" };
        try {
            signed = await this.signTransaction(transaction, privateKey);
            logger.info(`Transaction ${txId} is signed.`);
            await updateTransactionEntity(this.rootEm, txId, async (txEnt) => {
                txEnt.transactionHash = signed.txHash;
            });
        } catch (error: any) {
            if (isORMError(error)) { // We don't want to fail tx if error is caused by DB
                logger.error(`signAndSubmitProcess for transaction ${txId} failed with DB error: ${errorMessage(error)}`);
                return;
            }
            await failTransaction(this.rootEm, txId, `Cannot sign transaction ${txId}: ${errorMessage(error)}`, error);
            return;
        }

        if (await ServiceRepository.get(TransactionUTXOService).checkIfTxUsesAlreadySpentUTXOs(txId)) {
            return;
        }

        // submit
        const txStatus = await this.submitTransaction(signed.txBlob, txId);
        const txEnt = await fetchTransactionEntityById(this.rootEm, txId);
        if (txStatus == TransactionStatus.TX_PENDING) {
            await updateTransactionEntity(this.rootEm, txEnt.id, async (txEntToUpdate) => {
                txEntToUpdate.reachedStatusPendingInTimestamp = toBN(getCurrentTimestampInSeconds());
            });
            await this.waitForTransactionToAppearInMempool(txEnt.id, 0);
            logger.info(`Transaction ${txId} is accepted in mempool.`);
        } else if (txStatus == TransactionStatus.TX_FAILED) {
            //TODO update tx status?
        }
    }

    async tryToReplaceByFee(txId: number, currentBlockHeight: BlockData): Promise<void> {
        logger.info(`Transaction ${txId} is being replaced; currentBlockHeight: ${currentBlockHeight.number}, ${currentBlockHeight.timestamp}`);
        const rootEm = ServiceRepository.get(EntityManager);
        const oldTx = await fetchTransactionEntityById(rootEm, txId);
        const descendantsFee = await ServiceRepository.get(TransactionFeeService).calculateTotalFeeOfTxAndDescendants(rootEm, oldTx)
        const newFee: BN = (descendantsFee).muln(this.feeIncrease);//TODO
        let newValue: BN = oldTx.amount!;


        if (checkIfFeeTooHigh(newFee, oldTx.maxFee)) {
            await failTransaction(rootEm, txId, `tryToReplaceByFee: Transaction ${txId} failed due to fee restriction`);
            return;
        }

        if (!(await checkIfShouldStillSubmit(this, this.executionBlockOffset, oldTx.executeUntilBlock, oldTx.executeUntilTimestamp))) {
            newValue = newValue == null ? newValue : getMinAmountToSend(this.chainType);
        }

        const replacementTx = await createInitialTransactionEntity(rootEm, this.chainType, oldTx.source, oldTx.destination, newValue,
            newFee, oldTx.reference, oldTx.maxFee, oldTx.executeUntilBlock, oldTx.executeUntilTimestamp, oldTx);

        await updateTransactionEntity(rootEm, txId, async (txEnt) => {
            txEnt.replaced_by = replacementTx;
            txEnt.status = TransactionStatus.TX_REPLACED;
            txEnt.reachedFinalStatusInTimestamp = toBN(getCurrentTimestampInSeconds());
        });

        logger.info(`tryToReplaceByFee: Trying to RBF transaction ${txId}`);
        await this.prepareAndSubmitCreatedTransaction(replacementTx);

        const descendants = await getTransactionDescendants(rootEm, oldTx.transactionHash!, oldTx.source); // TODO-check
        for (const descendant of descendants) {
            const replacement = await createInitialTransactionEntity(rootEm, this.chainType, descendant.source, descendant.destination, descendant.amount || null,
                descendant.fee?.muln(this.feeIncrease), descendant.reference, descendant.maxFee, descendant.executeUntilBlock, descendant.executeUntilTimestamp);
            await removeUTXOsAndAddReplacement(rootEm, descendant.id, replacement);
        }
    }

    /**
     * @param {Object} transaction
     * @param {string} privateKey
     * @returns {string} - hex string
     */
    private async signTransaction(transaction: bitcore.Transaction, privateKey: string): Promise<SignedObject> {
        const signedAndSerialized = transaction.sign(privateKey).toString(); // serialize({disableLargeFees: true, disableSmallFees: true});
        const txId = transaction.id;
        return { txBlob: signedAndSerialized, txHash: txId };
    }

    /**
     * @param {string} signedTx
     * @param txId
     */
    private async submitTransaction(signedTx: string, txId: number): Promise<TransactionStatus> {
        // check if there is still time to submit
        const transaction = await fetchTransactionEntityById(this.rootEm, txId);
        const currentBlockHeight = await ServiceRepository.get(BlockchainAPIWrapper).getCurrentBlockHeight();
        const currentTimestamp = getCurrentTimestampInSeconds();
        const shouldSubmit = await checkIfShouldStillSubmit(this, currentBlockHeight.number, transaction.executeUntilBlock, transaction.executeUntilTimestamp);
        if (!shouldSubmit) {
            await failTransaction(this.rootEm, txId,
                `Transaction ${txId} has no time left to be submitted: currentBlockHeight: ${currentBlockHeight.number}, executeUntilBlock: ${transaction.executeUntilBlock}, offset ${this.executionBlockOffset}.
                Current timestamp ${currentTimestamp} >= execute until timestamp ${transaction.executeUntilTimestamp}.`);
            return TransactionStatus.TX_FAILED;
        } else if (!transaction.executeUntilBlock) {
            logger.warn(`Transaction ${txId} does not have 'executeUntilBlock' defined`);
        }
        try {
            const resp = await ServiceRepository.get(BlockchainAPIWrapper).sendTransaction(signedTx);
            if (resp.status == 200) {
                const submittedBlockHeight = await ServiceRepository.get(BlockchainAPIWrapper).getCurrentBlockHeight();
                await updateTransactionEntity(this.rootEm, txId, async (txEnt) => {
                    txEnt.status = TransactionStatus.TX_PENDING;
                    txEnt.submittedInBlock = submittedBlockHeight.number;
                    txEnt.submittedInTimestamp = toBN(submittedBlockHeight.timestamp);
                    txEnt.reachedStatusPendingInTimestamp = toBN(currentTimestamp);
                });
                await ServiceRepository.get(TransactionUTXOService).updateTransactionInputSpentStatus(txId, SpentHeightEnum.SENT);
                return TransactionStatus.TX_PENDING;
            } else {
                await failTransaction(this.rootEm, txId, `Transaction ${txId} submission failed ${resp.status}`, resp.data);
                await ServiceRepository.get(TransactionUTXOService).updateTransactionInputSpentStatus(txId, SpentHeightEnum.UNSPENT);
                return TransactionStatus.TX_FAILED;
            }
        } catch (error: any) {
            if (isORMError(error)) { // We don't want to fail tx if error is caused by DB
                logger.error(`Transaction ${txId} submission failed with DB error ${errorMessage(error)}`);
                return TransactionStatus.TX_PREPARED;
            } else if (axios.isAxiosError(error)) {
                return this.transactionAPISubmissionErrorHandler(txId, error);
            } else {
                await failTransaction(this.rootEm, txId, `Transaction ${txId} submission failed ${errorMessage(error)}`, error);
                await ServiceRepository.get(TransactionUTXOService).updateTransactionInputSpentStatus(txId, SpentHeightEnum.UNSPENT);
                return TransactionStatus.TX_FAILED;
            }

        }
    }

    private async waitForTransactionToAppearInMempool(txId: number, retry: number = 0): Promise<void> {
        logger.info(`Transaction ${txId} is waiting to be accepted in mempool.`);

        const rootEm = ServiceRepository.get(EntityManager);
        const txEnt = await fetchTransactionEntityById(rootEm, txId);
        const start = txEnt.submittedInTimestamp!;
        while (toBN(getCurrentTimestampInSeconds()).div(start).ltn(this.mempoolWaitingTimeInS)) {
            try {
                const txResp = await ServiceRepository.get(BlockchainAPIWrapper).getTransaction(txEnt.transactionHash);
                if (txResp) {
                    await updateTransactionEntity(rootEm, txId, async (txEnt) => {
                        txEnt.status = TransactionStatus.TX_SUBMITTED;
                        txEnt.acceptedToMempoolInTimestamp = toBN(getCurrentTimestampInSeconds());
                    });
                    return;
                }
            } catch (e) {
                if (axios.isAxiosError(e)) {
                    logger.warn(`Transaction ${txId} not yet seen in mempool`, e.response?.data);
                } else {
                    logger.warn(`Transaction ${txId} not yet seen in mempool`, e);
                }
                await sleepMs(1000);
            }
        }

        // transaction was not accepted in mempool by one minute => replace by fee one time
        if (retry == 0) {//TODO
            await failTransaction(rootEm, txId, `Transaction ${txId} was not accepted in mempool`);
        } else {
            const currentBlock = await ServiceRepository.get(BlockchainAPIWrapper).getCurrentBlockHeight();
            const shouldSubmit = await checkIfShouldStillSubmit(this, this.executionBlockOffset, txEnt.executeUntilBlock, txEnt.executeUntilTimestamp);
            if (!shouldSubmit) {
                await failTransaction(rootEm, txId, `waitForTransactionToAppearInMempool: Current ledger ${currentBlock.number} >= last transaction ledger ${txEnt.executeUntilBlock}`);
            }
            if (!this.checkIfTransactionWasFetchedFromAPI(txEnt)) {
                await this.tryToReplaceByFee(txId, currentBlock);
            }
        }
    }

    async transactionAPISubmissionErrorHandler(txId: number, error: any) {
        logger.error(`Transaction ${txId} submission failed with Axios error (${error.response?.data?.error}): ${errorMessage(error)}`);
        if (error.response?.data?.error?.indexOf("too-long-mempool-chain") >= 0) {
            logger.error(`Transaction ${txId} has too-long-mempool-chain`, error);
            return TransactionStatus.TX_PREPARED;
        } else if (error.response?.data?.error?.indexOf("transaction already in block chain") >= 0) {
            return TransactionStatus.TX_PENDING;
        } else if (error.response?.data?.error?.indexOf("insufficient fee") >= 0) {
            logger.error(`Transaction ${txId} submission failed because of 'insufficient fee'`);
            return TransactionStatus.TX_FAILED; // TODO should we invalidate the transaction and create a new one?
        } else if (error.response?.data?.error?.indexOf("mempool min fee not met") >= 0) {
            logger.error(`Transaction ${txId} submission failed because of 'mempool min fee not met'`);
            return TransactionStatus.TX_FAILED; // TODO should we invalidate the transaction and create a new one?
        } else if (error.response?.data?.error?.indexOf("bad-txns-inputs-") >= 0) {
            const txEnt = await fetchTransactionEntityById(this.rootEm, txId);
            await correctUTXOInconsistencies(this.rootEm, txEnt.source, await ServiceRepository.get(BlockchainAPIWrapper).getUTXOsWithoutScriptFromMempool(txEnt.source, this.chainType));
            txEnt.utxos.removeAll();
            txEnt.inputs.map(input => this.rootEm.remove(input));
            txEnt.outputs.map(output => this.rootEm.remove(output));
            await this.rootEm.persistAndFlush(txEnt);
        }

        return TransactionStatus.TX_PREPARED;
    }

    checkIfTransactionWasFetchedFromAPI(txEnt: TransactionEntity) {
        return txEnt.source.includes("FETCHED_VIA_API_UNKNOWN_DESTINATION") || txEnt.destination.includes("FETCHED_VIA_API_UNKNOWN_DESTINATION");
    }
}