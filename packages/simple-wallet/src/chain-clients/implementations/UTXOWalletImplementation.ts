import axios from "axios";
import * as bitcore from "bitcore-lib";
import { checkIfFeeTooHigh, checkIfShouldStillSubmit, getCurrentTimestampInSeconds, sleepMs, stuckTransactionConstants } from "../../utils/utils";
import { toBN, toNumber } from "../../utils/bnutils";
import { ChainType } from "../../utils/constants";
import { BaseWalletConfig, IWalletKeys, SignedObject, TransactionInfo, UTXOFeeParams, WriteWalletInterface } from "../../interfaces/IWalletTransaction";
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
    updateTransactionEntity,
} from "../../db/dbutils";
import { logger } from "../../utils/logger";
import { UTXOAccountGeneration } from "../account-generation/UTXOAccountGeneration";
import { TransactionEntity, TransactionStatus } from "../../entity/transaction";
import { SpentHeightEnum } from "../../entity/utxo";
import { BlockchainFeeService } from "../../fee-service/service";
import { EntityManager } from "@mikro-orm/core";
import { checkUTXONetworkStatus, getAccountBalance, getCore, getMinAmountToSend } from "../utxo/UTXOUtils";
import { BlockchainAPIWrapper } from "../../blockchain-apis/UTXOBlockchainAPIWrapper";
import { TransactionMonitor } from "../monitoring/TransactionMonitor";
import { ServiceRepository } from "../../ServiceRepository";
import { TransactionService } from "../utxo/TransactionService";
import { TransactionUTXOService } from "../utxo/TransactionUTXOService";
import { TransactionFeeService } from "../utxo/TransactionFeeService";
import { errorMessage, isORMError, LessThanDustAmountError, NotEnoughUTXOsError } from "../../utils/axios-error-utils";
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

    useRBFFactor = 1.4;

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

        ServiceRepository.register(this.chainType, EntityManager, this.rootEm);

        ServiceRepository.register(
            this.chainType,
            TransactionFeeService,
            new TransactionFeeService(this.chainType, this.feeDecileIndex, this.feeIncrease, this.relayFeePerB)
        );
        ServiceRepository.register(
            this.chainType,
            TransactionUTXOService,
            new TransactionUTXOService(this.chainType, this.mempoolChainLengthLimit, this.enoughConfirmations)
        );
        ServiceRepository.register(this.chainType, TransactionService, new TransactionService(this.chainType));
        ServiceRepository.register(this.chainType, BlockchainAPIWrapper, this.blockchainAPI);

        if (createConfig.feeServiceConfig && this.feeService) {
            ServiceRepository.register(this.chainType, BlockchainFeeService, this.feeService);
        }
    }

    async getAccountBalance(account: string, otherAddresses?: string[]): Promise<BN> {
        return await getAccountBalance(this.chainType, account, otherAddresses);
    }

    async getCurrentTransactionFee(params: UTXOFeeParams): Promise<BN> {
        return await ServiceRepository.get(this.chainType, TransactionFeeService).getCurrentTransactionFee(params);
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
        executeUntilTimestamp?: BN
    ): Promise<number> {
        await this.walletKeys.addKey(source, privateKey);
        return ServiceRepository.get(this.chainType, TransactionService).createPaymentTransaction(
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
        executeUntilTimestamp?: BN
    ): Promise<number> {
        await this.walletKeys.addKey(source, privateKey);
        return ServiceRepository.get(this.chainType, TransactionService).createDeleteAccountTransaction(
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
        const currentBlock = await ServiceRepository.get(this.chainType, BlockchainAPIWrapper).getCurrentBlockHeight();
        const currentTimestamp = getCurrentTimestampInSeconds();
        const shouldSubmit = await checkIfShouldStillSubmit(this, currentBlock.number, txEnt.executeUntilBlock, txEnt.executeUntilTimestamp);
        if (txEnt.rbfReplacementFor == null && !shouldSubmit) {
            await failTransaction(
                this.rootEm,
                txEnt.id,
                `prepareAndSubmitCreatedTransaction: Both conditions met for transaction ${txEnt.id}: Current ledger ${currentBlock.number} >= last transaction ledger ${txEnt.executeUntilBlock} AND Current timestamp ${currentTimestamp} >= execute until timestamp ${txEnt.executeUntilTimestamp}`
            );
            return;
        } else if (!!txEnt.executeUntilBlock && !!txEnt.executeUntilTimestamp) {
            await updateTransactionEntity(this.rootEm, txEnt.id, async (txEnt) => {
                txEnt.executeUntilBlock = currentBlock.number + this.blockOffset;
            });
        }
        logger.info(`Preparing transaction ${txEnt.id}`);
        // TODO: determine how often this should be run - if there will be lots of UTXOs api fetches and updates can become too slow (but do we want to risk inconsistency?)
        await correctUTXOInconsistencies(
            this.rootEm,
            txEnt.source,
            await ServiceRepository.get(this.chainType, BlockchainAPIWrapper).getUTXOsWithoutScriptFromMempool(txEnt.source, this.chainType)
        );

        try {
            // rbfReplacementFor is used since the RBF needs to use at least of the UTXOs spent by the original transaction
            const rbfReplacementFor = txEnt.rbfReplacementFor ? await fetchTransactionEntityById(this.rootEm, txEnt.rbfReplacementFor.id) : undefined;
            const [transaction, dbUTXOs] = await ServiceRepository.get(this.chainType, TransactionService).preparePaymentTransaction(
                txEnt.id,
                txEnt.source,
                txEnt.destination,
                txEnt.amount || null,
                txEnt.fee,
                txEnt.reference,
                rbfReplacementFor
            );
            const privateKey = await this.walletKeys.getKey(txEnt.source);

            if (!privateKey) {
                await handleMissingPrivateKey(this.rootEm, txEnt.id, "prepareAndSubmitCreatedTransaction");
                return;
            }
            if (checkIfFeeTooHigh(toBN(transaction.getFee()), txEnt.maxFee || null)) {
                if (rbfReplacementFor) {
                    transaction.fee(toNumber(txEnt.maxFee!));
                } else {
                    await failTransaction(this.rootEm, txEnt.id, `Fee restriction (fee: ${transaction.getFee()}, maxFee: ${txEnt.maxFee?.toString()})`);
                    return;
                }
            } else {
                const inputs = await ServiceRepository.get(this.chainType, TransactionUTXOService).createInputsFromUTXOs(dbUTXOs, txEnt.id);
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
            if (error instanceof NotEnoughUTXOsError) {
                logger.warn(`Not enough UTXOs for transaction ${txEnt.id}, fetching them from mempool`);
                await ServiceRepository.get(this.chainType, TransactionUTXOService).fillUTXOsFromMempool(txEnt.source);
            } else if (error instanceof LessThanDustAmountError) {
                await failTransaction(this.rootEm, txEnt.id, error.message);
            } else if (axios.isAxiosError(error)) {
                logger.error(`prepareAndSubmitCreatedTransaction for transaction ${txEnt.id} failed with:`, error.response?.data);
                if (error.response?.data?.error?.indexOf("not found") >= 0) {
                    console.log("NOT FOUND")
                    let utxosToBeChecked;
                    if (txEnt.rbfReplacementFor) {
                        utxosToBeChecked = txEnt.rbfReplacementFor.utxos;
                    } else {
                        utxosToBeChecked = txEnt.utxos;
                    }
                    for (const utxo of utxosToBeChecked) {
                        if(utxo.spentHeight === SpentHeightEnum.SPENT) {
                            await updateTransactionEntity(this.rootEm, txEnt.id, async (txEnt) => {
                                txEnt.status = TransactionStatus.TX_CREATED;
                                txEnt.utxos.removeAll();
                                txEnt.inputs.removeAll();
                                txEnt.outputs.removeAll();
                                txEnt.raw = "";
                                txEnt.transactionHash = "";
                                // txEnt.replaced_by = null;
                                // txEnt.rbfReplacementFor = null;
                            });
                            logger.info(`Transaction ${txEnt.id} changed status to created due to invalid utxo ${utxo.mintTransactionHash}`);
                            if (txEnt.rbfReplacementFor) {
                                await updateTransactionEntity(this.rootEm, txEnt.rbfReplacementFor.id, async (txEnt) => {
                                    txEnt.utxos.removeAll();
                                    txEnt.inputs.removeAll();
                                    txEnt.outputs.removeAll();
                                });
                                logger.info(`Original transaction ${txEnt.rbfReplacementFor.id} was cleared due to invalid utxo ${utxo.mintTransactionHash}`);
                            }

                            break;
                        }
                    }
                }

            } else {
                logger.error(`prepareAndSubmitCreatedTransaction for transaction ${txEnt.id} failed with:`, error);
            }
            return;
        }
    }

    async checkSubmittedTransaction(txEnt: TransactionEntity): Promise<void> {
        if(txEnt)
        logger.info(`Submitted transaction ${txEnt.id} (${txEnt.transactionHash}) is being checked.`);
        try {
            const txResp = await ServiceRepository.get(this.chainType, BlockchainAPIWrapper).getTransaction(txEnt.transactionHash);
            // success
            if (txResp.data.blockHash && txResp.data.confirmations) {
                logger.info(`Submitted transaction ${txEnt.id} has ${txResp.data.confirmations}. Needed ${this.enoughConfirmations}.`);
            }
            if (txResp.data.blockHash && txResp.data.confirmations >= this.enoughConfirmations) {
                await updateTransactionEntity(this.rootEm, txEnt.id, async (txEntToUpdate) => {
                    txEntToUpdate.confirmations = txResp.data.confirmations;
                    txEntToUpdate.status = TransactionStatus.TX_SUCCESS;
                    txEntToUpdate.reachedFinalStatusInTimestamp = toBN(getCurrentTimestampInSeconds());
                });
                if (!this.checkIfTransactionWasFetchedFromAPI(txEnt)) {
                    await ServiceRepository.get(this.chainType, TransactionUTXOService).updateTransactionInputSpentStatus(txEnt.id, SpentHeightEnum.SPENT);
                }
                logger.info(`Transaction ${txEnt.id} (${txEnt.transactionHash}) was accepted`);
                return;
            } else {
                const currentBlockHeight = await ServiceRepository.get(this.chainType, BlockchainAPIWrapper).getCurrentBlockHeight();
                // if only one block left to submit => replace by fee
                const stillTimeToSubmit =  checkIfShouldStillSubmit(this, currentBlockHeight.number, txEnt.executeUntilBlock, txEnt.executeUntilTimestamp);
                if (
                    !this.checkIfTransactionWasFetchedFromAPI(txEnt) && !stillTimeToSubmit && !txResp.data.blockHash
                ) {
                    await this.tryToReplaceByFee(txEnt.id, currentBlockHeight);
                }
            }
        } catch (error) {
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

            if (txEnt.ancestor) {// tx fails and it has ancestor defined -> original ancestor was rbf-ed
                // if ancestors rbf is accepted
                if (!!txEnt.ancestor.replaced_by) {

                }
                // // if ancestors rbf is not accepted - wait
                // if (!(txEnt.ancestor.replaced_by && txEnt.ancestor.replaced_by.status === TransactionStatus.TX_SUCCESS)) {
                //     return;
                // // ancestors rbf is accepted - new transactions are needed
                // } else if (txEnt.ancestor.replaced_by && txEnt.ancestor.replaced_by.status === TransactionStatus.TX_SUCCESS) {
                //     await correctUTXOInconsistencies(
                //         this.rootEm,
                //         txEnt.source,
                //         await ServiceRepository.get(this.chainType, BlockchainAPIWrapper).getUTXOsWithoutScriptFromMempool(txEnt.source, this.chainType)
                //     );
                //     // recreate transaction
                //     await updateTransactionEntity(this.rootEm, txEnt.id, async (txEnt) => {
                //         txEnt.status = txEnt.rbfReplacementFor ? TransactionStatus.TX_FAILED : TransactionStatus.TX_CREATED;
                //         txEnt.utxos.removeAll();
                //         txEnt.inputs.removeAll();
                //         txEnt.outputs.removeAll();
                //         txEnt.raw = "";
                //         txEnt.transactionHash = "";
                //         // txEnt.replaced_by = null;
                //         // txEnt.rbfReplacementFor = null;
                //     });
                //     logger.info(`checkSubmittedTransaction (ancestor) transaction ${txEnt.id} changed status to ${txEnt.rbfReplacementFor ? TransactionStatus.TX_FAILED : TransactionStatus.TX_CREATED}.`);
                // }
            }
            // if (txEnt.rbfReplacementFor) {
            //     await updateTransactionEntity(this.rootEm, txEnt.rbfReplacementFor.id, async (txEnt) => {
            //         txEnt.status = TransactionStatus.TX_SUCCESS;
            //         // txEnt.replaced_by = null;
            //     });
            // }
            // await correctUTXOInconsistencies(
            //     this.rootEm,
            //     txEnt.source,
            //     await ServiceRepository.get(this.chainType, BlockchainAPIWrapper).getUTXOsWithoutScriptFromMempool(txEnt.source, this.chainType)
            // );
            // await updateTransactionEntity(this.rootEm, txEnt.id, async (txEnt) => {
            //     txEnt.status = txEnt.rbfReplacementFor ? TransactionStatus.TX_FAILED : TransactionStatus.TX_CREATED;
            //     txEnt.utxos.removeAll();
            //     txEnt.inputs.removeAll();
            //     txEnt.outputs.removeAll();
            //     txEnt.raw = "";
            //     txEnt.transactionHash = "";
            //     // txEnt.replaced_by = null;
            //     // txEnt.rbfReplacementFor = null;
            // });
            logger.info(`checkSubmittedTransaction transaction ${txEnt.id} changed status to ${txEnt.rbfReplacementFor ? TransactionStatus.TX_FAILED : TransactionStatus.TX_CREATED}.`);
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
            signed = await this.signTransaction(transaction, privateKey);
            logger.info(`Transaction ${txId} is signed.`);
            await updateTransactionEntity(this.rootEm, txId, async (txEnt) => {
                txEnt.transactionHash = signed.txHash;
                txEnt.size = signed.txSize;
            });
        } catch (error: any) {
            if (isORMError(error)) {
                // We don't want to fail tx if error is caused by DB
                logger.error(`signAndSubmitProcess for transaction ${txId} failed with DB error: ${errorMessage(error)}`);
                return;
            }
            await failTransaction(this.rootEm, txId, `Cannot sign transaction ${txId}: ${errorMessage(error)}`, error);
            return;
        }

        if (await ServiceRepository.get(this.chainType, TransactionUTXOService).checkIfTxUsesAlreadySpentUTXOs(txId)) {
            return;
        }

        // submit
        const txStatus = await this.submitTransaction(signed.txBlob, txId);
        const txEnt = await fetchTransactionEntityById(this.rootEm, txId);
        if (txStatus == TransactionStatus.TX_PENDING) {
            await updateTransactionEntity(this.rootEm, txEnt.id, async (txEntToUpdate) => {
                txEntToUpdate.reachedStatusPendingInTimestamp = toBN(getCurrentTimestampInSeconds());
            });
            await this.waitForTransactionToAppearInMempool(txEnt.id);
        } else if (txStatus == TransactionStatus.TX_FAILED) {
            //TODO update tx status?
        }
    }

    async tryToReplaceByFee(txId: number, currentBlockHeight: BlockData): Promise<void> {
        logger.info(`Transaction ${txId} is being replaced; currentBlockHeight: ${currentBlockHeight.number}, ${currentBlockHeight.timestamp}`);
        const rootEm = ServiceRepository.get(this.chainType, EntityManager);
        const oldTx = await fetchTransactionEntityById(rootEm, txId);
        if (!!oldTx.ancestor) { //TODO
            logger.info(`tryToReplaceByFee: Not yet allowed for transaction ${txId}, ancestor did not rbf yet ${oldTx.ancestor.id}.`);
            return
        }
        // send minimal amount (as time for payment passed) or "delete transaction" amount
        const newValue: BN | null = oldTx.amount == null ? null : getMinAmountToSend(this.chainType)
        const descendantsFee: BN = toBN(await ServiceRepository.get(this.chainType, TransactionFeeService).calculateTotalFeeOfDescendants(rootEm, oldTx));
        const newFee: BN = descendantsFee; // covering conflicting txs

        const replacementTx = await createInitialTransactionEntity(
            rootEm,
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

        await updateTransactionEntity(rootEm, txId, async (txEnt) => {
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
    private async signTransaction(transaction: bitcore.Transaction, privateKey: string): Promise<SignedObject> {
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
        const currentBlockHeight = await ServiceRepository.get(this.chainType, BlockchainAPIWrapper).getCurrentBlockHeight();
        const currentTimestamp = getCurrentTimestampInSeconds();
        const shouldSubmit = await checkIfShouldStillSubmit(this, currentBlockHeight.number, transaction.executeUntilBlock, transaction.executeUntilTimestamp);
        const txEntity = await fetchTransactionEntityById(this.rootEm, txId);
        if (txEntity.rbfReplacementFor == null && !shouldSubmit) {
            await failTransaction(
                this.rootEm,
                txId,
                `Transaction ${txId} has no time left to be submitted: currentBlockHeight: ${currentBlockHeight.number}, executeUntilBlock: ${transaction.executeUntilBlock}, offset ${this.executionBlockOffset}.
                Current timestamp ${currentTimestamp} >= execute until timestamp ${transaction.executeUntilTimestamp}.`
            );
            return TransactionStatus.TX_FAILED;
        } else if (!transaction.executeUntilBlock) {
            logger.warn(`Transaction ${txId} does not have 'executeUntilBlock' defined`);
        }
        try {
            const resp = await ServiceRepository.get(this.chainType, BlockchainAPIWrapper).sendTransaction(signedTx);
            if (resp.status == 200) {
                const submittedBlockHeight = await ServiceRepository.get(this.chainType, BlockchainAPIWrapper).getCurrentBlockHeight();
                await updateTransactionEntity(this.rootEm, txId, async (txEnt) => {
                    txEnt.status = TransactionStatus.TX_PENDING;
                    txEnt.submittedInBlock = submittedBlockHeight.number;
                    txEnt.submittedInTimestamp = toBN(submittedBlockHeight.timestamp);
                    txEnt.reachedStatusPendingInTimestamp = toBN(currentTimestamp);
                });
                await ServiceRepository.get(this.chainType, TransactionUTXOService).updateTransactionInputSpentStatus(txId, SpentHeightEnum.SENT);
                return TransactionStatus.TX_PENDING;
            } else {
                await failTransaction(this.rootEm, txId, `Transaction ${txId} submission failed ${resp.status}`, resp.data);
                await ServiceRepository.get(this.chainType, TransactionUTXOService).updateTransactionInputSpentStatus(txId, SpentHeightEnum.UNSPENT);
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
                await ServiceRepository.get(this.chainType, TransactionUTXOService).updateTransactionInputSpentStatus(txId, SpentHeightEnum.UNSPENT);
                return TransactionStatus.TX_FAILED;
            }
        }
    }

    private async waitForTransactionToAppearInMempool(txId: number): Promise<void> {
        logger.info(`Transaction ${txId} is waiting to be accepted in mempool.`);
        const rootEm = ServiceRepository.get(this.chainType, EntityManager);
        const txEnt = await fetchTransactionEntityById(rootEm, txId);
        const start = txEnt.reachedStatusPendingInTimestamp!;
        while (toBN(getCurrentTimestampInSeconds()).sub(start).ltn(this.mempoolWaitingTimeInS)) {
            try {
                const txResp = await ServiceRepository.get(this.chainType, BlockchainAPIWrapper).getTransaction(txEnt.transactionHash);
                if (txResp) {
                    await updateTransactionEntity(rootEm, txId, async (txEnt) => {
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
                await sleepMs(1000);
            }
        }

        // transaction was not accepted in mempool by one minute => replace by fee one time
        const currentBlock = await ServiceRepository.get(this.chainType, BlockchainAPIWrapper).getCurrentBlockHeight();
        const shouldSubmit = await checkIfShouldStillSubmit(this, currentBlock.number, txEnt.executeUntilBlock, txEnt.executeUntilTimestamp);
        if (!shouldSubmit) {
            await failTransaction(
                rootEm,
                txId,
                `waitForTransactionToAppearInMempool: Current ledger ${currentBlock.number} >= last transaction ledger ${txEnt.executeUntilBlock}`
            );
        } // TODO - should we rbf?
        // if (!this.checkIfTransactionWasFetchedFromAPI(txEnt)) {
        //     await this.tryToReplaceByFee(txId, currentBlock);
        // }
    }

    async transactionAPISubmissionErrorHandler(txId: number, error: any) {
        const txEnt = await fetchTransactionEntityById(this.rootEm, txId);
        //TODO should be statuses updated on entities?
        logger.error(`Transaction ${txId} submission failed with Axios error (${error.response?.data?.error}): ${errorMessage(error)}`);
        if (error.response?.data?.error?.indexOf("too-long-mempool-chain") >= 0) {
            logger.error(`Transaction ${txId} has too-long-mempool-chain`, error);
            return TransactionStatus.TX_PREPARED;
        } else if (error.response?.data?.error?.indexOf("transaction already in block chain") >= 0) {
            return TransactionStatus.TX_PENDING;
        } else if (error.response?.data?.error?.indexOf("insufficient fee") >= 0) {
            logger.error(`Transaction ${txId} submission failed because of 'insufficient fee'`);
            await updateTransactionEntity(this.rootEm, txEnt.id, async (txEnt) => {
                txEnt.status = TransactionStatus.TX_CREATED;
                txEnt.utxos.removeAll();
                txEnt.inputs.removeAll();
                txEnt.outputs.removeAll();
                txEnt.raw = "";
                txEnt.transactionHash = "";
            });
            return TransactionStatus.TX_CREATED;
        } else if (error.response?.data?.error?.indexOf("mempool min fee not met") >= 0) {
            logger.error(`Transaction ${txId} submission failed because of 'mempool min fee not met'`);
            await updateTransactionEntity(this.rootEm, txEnt.id, async (txEnt) => {
                txEnt.status = TransactionStatus.TX_CREATED;
                txEnt.utxos.removeAll();
                txEnt.inputs.removeAll();
                txEnt.outputs.removeAll();
                txEnt.raw = "";
                txEnt.transactionHash = "";
            });
            return TransactionStatus.TX_CREATED;
        } else if (error.response?.data?.error?.indexOf("min relay fee not met") >= 0) {
            logger.error(`Transaction ${txId} submission failed because of 'min relay fee not met'`);
            await updateTransactionEntity(this.rootEm, txEnt.id, async (txEnt) => {
                txEnt.status = TransactionStatus.TX_CREATED;
                txEnt.utxos.removeAll();
                txEnt.inputs.removeAll();
                txEnt.outputs.removeAll();
                txEnt.raw = "";
                txEnt.transactionHash = "";
            });
            return TransactionStatus.TX_CREATED;
        } else if (error.response?.data?.error?.indexOf("Fee exceeds maximum configured by user") >= 0) {
            logger.error(`Transaction ${txId} submission failed because of 'Fee exceeds maximum configured by user'`);
            await updateTransactionEntity(this.rootEm, txEnt.id, async (txEnt) => {
                txEnt.status = TransactionStatus.TX_CREATED;
                txEnt.utxos.removeAll();
                txEnt.inputs.removeAll();
                txEnt.outputs.removeAll();
                txEnt.raw = "";
                txEnt.transactionHash = "";
            });
            return TransactionStatus.TX_CREATED;
        } else if (error.response?.data?.error?.indexOf("bad-txns-inputs-") >= 0) {
            const txEnt = await fetchTransactionEntityById(this.rootEm, txId);
            // presumably original was accepted
            if (error.response?.data?.error?.indexOf("bad-txns-inputs-missingorspent") >= 0 && txEnt.rbfReplacementFor) {
                await updateTransactionEntity(this.rootEm, txEnt.rbfReplacementFor.id, async (txEnt) => {
                    txEnt.status = TransactionStatus.TX_SUCCESS;
                });
            }
            await correctUTXOInconsistencies(
                this.rootEm,
                txEnt.source,
                await ServiceRepository.get(this.chainType, BlockchainAPIWrapper).getUTXOsWithoutScriptFromMempool(txEnt.source, this.chainType)
            );
            await updateTransactionEntity(this.rootEm, txId, async (txEnt) => {
                txEnt.status = txEnt.rbfReplacementFor ? TransactionStatus.TX_FAILED : TransactionStatus.TX_CREATED;
                txEnt.utxos.removeAll();
                txEnt.inputs.removeAll();
                txEnt.outputs.removeAll();
                txEnt.raw = "";
                txEnt.transactionHash = "";
            });
            return TransactionStatus.TX_FAILED;
        }
        return TransactionStatus.TX_PREPARED;
    }

    checkIfTransactionWasFetchedFromAPI(txEnt: TransactionEntity) {
        return txEnt.source.includes("FETCHED_VIA_API_UNKNOWN_DESTINATION") || txEnt.destination.includes("FETCHED_VIA_API_UNKNOWN_DESTINATION");
    }
}
