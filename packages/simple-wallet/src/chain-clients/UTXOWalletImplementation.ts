import axios, { AxiosRequestConfig } from "axios";
import * as bitcore from "bitcore-lib";
import { Transaction } from "bitcore-lib";
import * as dogecore from "bitcore-lib-doge";
import { excludeNullFields, getDefaultFeePerKB, getRandomInt, sleepMs, stuckTransactionConstants, unPrefix0x } from "../utils/utils";
import { toBN, toBNExp, toNumber } from "../utils/bnutils";
import { excludeNullFields, sleepMs, stuckTransactionConstants, unPrefix0x } from "../utils/utils";
import { toBN, toNumber } from "../utils/bnutils";
import {
    BTC_DOGE_DEC_PLACES,
    BTC_DUST_AMOUNT,
    BTC_FEE_SECURITY_MARGIN,
    BTC_LEDGER_CLOSE_TIME_MS,
    BUFFER_PING_INTERVAL,
    ChainType,
    DEFAULT_RATE_LIMIT_OPTIONS,
    DOGE_DUST_AMOUNT,
    DOGE_FEE_SECURITY_MARGIN,
    DOGE_LEDGER_CLOSE_TIME_MS,
    PING_INTERVAL,
    UTXO_INPUT_SIZE,
    UTXO_INPUT_SIZE_SEGWIT,
    UTXO_OUTPUT_SIZE,
    UTXO_OUTPUT_SIZE_SEGWIT,
    UTXO_OVERHEAD_SIZE,
    UTXO_OVERHEAD_SIZE_SEGWIT,
} from "../utils/constants";
import type {
    BaseWalletConfig,
    ISubmitTransactionResponse,
    IWalletKeys,
    SignedObject,
    TransactionInfo,
    UTXO,
    UTXOFeeParams,
    WriteWalletInterface,
} from "../interfaces/IWalletTransaction";
// eslint-disable-next-line @typescript-eslint/no-var-requires
import BN, { max } from "bn.js";
import {
    checkIfIsDeleting,
    correctUTXOInconsistencies,
    createInitialTransactionEntity,
    createTransactionOutputEntities,
    failTransaction,
    fetchTransactionEntityById,
    fetchUnspentUTXOs,
    fetchUTXOs,
    getTransactionInfoById,
    handleMissingPrivateKey,
    processTransactions,
    setAccountIsDeleting,
    storeUTXOS,
    updateTransactionEntity,
    updateUTXOEntity,
    fetchMonitoringState,
    updateMonitoringState
} from "../db/dbutils";
import { MonitoringStateEntity } from "../entity/monitoring_state";
import { logger } from "../utils/logger";
import { UTXOAccountGeneration } from "./account-generation/UTXOAccountGeneration";
import { TransactionEntity, TransactionStatus } from "../entity/transaction";
import { SpentHeightEnum, UTXOEntity } from "../entity/utxo";
import { FeeService } from "../fee-service/service";
import { EntityManager, RequiredEntityData } from "@mikro-orm/core";
import { IBlockchainAPI } from "../interfaces/IBlockchainAPI";
import { BitcoreAPI } from "../blockchain-apis/BitcoreAPI";
import { BlockbookAPI } from "../blockchain-apis/BlockbookAPI";
import { errorMessage, isORMError } from "./utils";
import { InvalidFeeError, NotEnoughUTXOsError } from "../@types/errors";
import UnspentOutput = Transaction.UnspentOutput;
import {
    checkIfFeeTooHigh, checkIfShouldStillSubmit,
    checkUTXONetworkStatus,
    getCore, getDustAmount,
    getEstimatedNumberOfOutputs,
    getEstimateFee, getFeePerKB, getNumberOfAncestorsInMempool, hasTooHighOrLowFee,
} from "./UTXOUtils";

export abstract class UTXOWalletImplementation extends UTXOAccountGeneration implements WriteWalletInterface {
    inTestnet: boolean;
    rootEm!: EntityManager;
    walletKeys!: IWalletKeys;
    blockOffset: number;
    feeIncrease: number;
    executionBlockOffset: number;
    feeDecileIndex: number = 8; // 8-th decile
    feeService?: FeeService;
    blockchainAPI: IBlockchainAPI;
    mempoolChainLengthLimit: number = 25;

    monitoring: boolean = false;
    enoughConfirmations: number;
    mempoolWaitingTime: number = 60000; // 1min

    restartInDueToError: number = 2000; //2s
    restartInDueNoResponse: number = 20000; //20s

    constructor(public chainType: ChainType, createConfig: BaseWalletConfig) {
        super(chainType);
        this.inTestnet = createConfig.inTestnet ?? false;
        const createAxiosConfig: AxiosRequestConfig = {
            baseURL: createConfig.url,
            headers: excludeNullFields({
                "Content-Type": "application/json",
                "x-apikey": createConfig.apiTokenKey,
            }),
            auth:
                createConfig.username && createConfig.password
                    ? {
                        username: createConfig.username,
                        password: createConfig.password,
                    }
                    : undefined,
            timeout: createConfig.rateLimitOptions?.timeoutMs ?? DEFAULT_RATE_LIMIT_OPTIONS.timeoutMs,
            validateStatus: function(status: number) {
                /* istanbul ignore next */
                return (status >= 200 && status < 300) || status == 500;
            },
        };
        this.blockchainAPI = createConfig.api === "bitcore" ? new BitcoreAPI(createAxiosConfig, createConfig.rateLimitOptions) : new BlockbookAPI(createAxiosConfig, createConfig.rateLimitOptions, createConfig.em);
        const resubmit = stuckTransactionConstants(this.chainType);
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        this.blockOffset = createConfig.stuckTransactionOptions?.blockOffset ?? resubmit.blockOffset!;
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        this.feeIncrease = createConfig.stuckTransactionOptions?.feeIncrease ?? resubmit.feeIncrease!;
        this.executionBlockOffset = createConfig.stuckTransactionOptions?.executionBlockOffset ?? resubmit.executionBlockOffset!;
        this.rootEm = createConfig.em;
        this.walletKeys = createConfig.walletKeys;
        this.enoughConfirmations = createConfig.enoughConfirmations ?? resubmit.enoughConfirmations!;
        this.feeDecileIndex = createConfig.feeDecileIndex ?? this.feeDecileIndex;
        if (createConfig.feeServiceConfig) {
            this.feeService = new FeeService(createConfig.feeServiceConfig);
        }
    }

    /**
     * @param {string} account
     * @param otherAddresses
     * @returns {BN} - confirmed balance in satoshis
     */
    async getAccountBalance(account: string, otherAddresses?: string[]): Promise<BN> {
        try {
            const accountBalance = await this.blockchainAPI.getAccountBalance(account);
            if (!accountBalance) {
                throw new Error("Account balance not found");
            }
            const mainAccountBalance = toBN(accountBalance);
            if (!otherAddresses) {
                return mainAccountBalance;
            } else {
                const balancePromises = otherAddresses.map(address => this.blockchainAPI.getAccountBalance(address));
                const balanceResponses = await Promise.all(balancePromises);
                const totalAddressesBalance = balanceResponses.reduce((sum, balance) => {
                    return balance ? sum! + balance : balance;
                }, 0);
                return toBN(totalAddressesBalance!).add(mainAccountBalance);
            }
        } catch (error) {
            logger.error(`Cannot get account balance for ${account} and other addresses ${otherAddresses}: ${errorMessage(error)}`);
            throw error;
        }
    }

    /**
     * @param {UTXOFeeParams} params - basic data needed to estimate fee
     * @returns {BN} - current transaction/network fee in satoshis
     */
    async getCurrentTransactionFee(params: UTXOFeeParams): Promise<BN> {
        const tx = await this.preparePaymentTransaction(params.source, params.destination, params.amount);
        return toBN(tx.getFee());
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
        executeUntilTimestamp?: number,
    ): Promise<number> {
        logger.info(`Received request to create tx from ${source} to ${destination} with amount ${amountInSatoshi} and reference ${note}`);
        if (await checkIfIsDeleting(this.rootEm, source)) {
            logger.error(`Cannot receive requests. ${source} is deleting`);
            throw new Error(`Cannot receive requests. ${source} is deleting`);
        }
        await this.walletKeys.addKey(source, privateKey);
        const ent = await createInitialTransactionEntity(
            this.rootEm,
            this.chainType,
            source,
            destination,
            amountInSatoshi,
            feeInSatoshi,
            note,
            maxFeeInSatoshi,
            executeUntilBlock,
            executeUntilTimestamp,
        );
        const txExternalId = ent.id;
        return txExternalId;
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
        executeUntilTimestamp?: number,
    ): Promise<number> {
        logger.info(`Received request to delete account from ${source} to ${destination} with reference ${note}`);
        if (await checkIfIsDeleting(this.rootEm, source)) {
            logger.error(`Cannot receive requests. ${source} is deleting`);
            throw new Error(`Cannot receive requests. ${source} is deleting`);
        }
        await this.walletKeys.addKey(source, privateKey);
        await this.walletKeys.addKey(source, privateKey);
        await setAccountIsDeleting(this.rootEm, source);
        const ent = await createInitialTransactionEntity(
            this.rootEm,
            this.chainType,
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

    ///////////////////////////////////////////////////////////////////////////////////////
    // MONITORING /////////////////////////////////////////////////////////////////////////
    ///////////////////////////////////////////////////////////////////////////////////////

    async isMonitoring(): Promise<boolean> {
        const monitoringState = await fetchMonitoringState(this.rootEm, this.chainType);
        if (!monitoringState) {
           return false;
        }
        const now = (new Date()).getTime();
        const elapsed = now - monitoringState.lastPingInTimestamp.toNumber();
        return elapsed < BUFFER_PING_INTERVAL;
     }

     async stopMonitoring(): Promise<void> {
        await updateMonitoringState(this.rootEm, this.chainType, async (monitoringEnt) => {
           monitoringEnt.lastPingInTimestamp = toBN(0);
        });
        this.monitoring = false;
     }

    /**
     * Background processing
     */
    async startMonitoringTransactionProgress(): Promise<void> {
        try {
            const monitoringState = await fetchMonitoringState(this.rootEm, this.chainType);
            if (!monitoringState) {
               this.rootEm.create(MonitoringStateEntity, { chainType: this.chainType, lastPingInTimestamp: toBN((new Date()).getTime()) } as RequiredEntityData<MonitoringStateEntity>,);
               await this.rootEm.flush();
            } else if (monitoringState.lastPingInTimestamp) {
               const now = (new Date()).getTime();
               if ((now - monitoringState.lastPingInTimestamp.toNumber()) < BUFFER_PING_INTERVAL) {
                  await sleepMs(BUFFER_PING_INTERVAL + getRandomInt(0, 500));
                  // recheck the monitoring state
                  const updatedMonitoringState = await fetchMonitoringState(this.rootEm, this.chainType);
                  const newNow = (new Date()).getTime();
                  if (updatedMonitoringState && (newNow - updatedMonitoringState.lastPingInTimestamp.toNumber()) < BUFFER_PING_INTERVAL) {
                     logger.info(`Another monitoring instance is already running for chain ${this.chainType}.`);
                     return;
                  }
               }
            }
            await updateMonitoringState(this.rootEm, this.chainType, async (monitoringEnt) => {
               monitoringEnt.lastPingInTimestamp = toBN((new Date()).getTime());
            });
            this.monitoring = true;
            logger.info(`Monitoring started for chain ${this.chainType}`);

            void this.updatePing();

            while (this.monitoring) {
                try {
                    const networkUp = await checkUTXONetworkStatus(this);
                    if (!networkUp) {
                        logger.error(`Network is down - trying again in ${this.restartInDueNoResponse}`);
                        await sleepMs(this.restartInDueNoResponse);
                        continue;
                    }

                    await processTransactions(this.rootEm, this.chainType, TransactionStatus.TX_PREPARED, this.submitPreparedTransactions.bind(this));
                    if (this.shouldStopMonitoring()) break;
                    await processTransactions(this.rootEm, this.chainType, TransactionStatus.TX_PENDING, this.checkPendingTransaction.bind(this));
                    if (this.shouldStopMonitoring()) break;
                    await processTransactions(this.rootEm, this.chainType, TransactionStatus.TX_CREATED, this.prepareAndSubmitCreatedTransaction.bind(this));
                    if (this.shouldStopMonitoring()) break;
                    await processTransactions(this.rootEm, this.chainType, TransactionStatus.TX_SUBMITTED, this.checkSubmittedTransaction.bind(this));
                    if (this.shouldStopMonitoring()) break;
                } catch (error) {
                    logger.error(`Monitoring run into error. Restarting in ${this.restartInDueToError}: ${errorMessage(error)}`);
                }
                await sleepMs(this.restartInDueToError);
            }
            logger.info(`Monitoring stopped for chain ${this.chainType}.`);
        } catch (error) {
            logger.error(`Monitoring failed for chain ${this.chainType} error: ${errorMessage(error)}.`);
        }
    }

    shouldStopMonitoring() {
        if (!this.monitoring) {
            logger.info(`Monitoring should be stopped for chain ${this.chainType}`);
            return true;
        }
        return false;
    }

    async checkUTXONetworkStatus(): Promise<boolean> {
        //TODO - maybe can be more robust if also take into account response
        try {
            await this.getCurrentBlockHeight();
            return true;
        } catch (error) {
            logger.error(`Cannot get response from server ${error}`);
            return false;
        }
    }

    private async updatePing(): Promise<void> {
        while (this.monitoring) {
           try {
              await updateMonitoringState(this.rootEm, this.chainType, async (monitoringEnt) => {
                 monitoringEnt.lastPingInTimestamp = toBN((new Date()).getTime());
              });
              await sleepMs(PING_INTERVAL);
           } catch (error) {
              logger.error(`Error updating ping status for chain ${this.chainType}`, error);
              this.monitoring = false;// TODO-urska -> better handle
           }
        }
     }
    ///////////////////////////////////////////////////////////////////////////////////////
    // HELPER OR CLIENT SPECIFIC FUNCTIONS ////////////////////////////////////////////////
    ///////////////////////////////////////////////////////////////////////////////////////
    async prepareAndSubmitCreatedTransaction(txEnt: TransactionEntity): Promise<void> {
        const currentBlock = await this.blockchainAPI.getCurrentBlockHeight();
        const currentTimestamp = new Date().getTime();
        if (txEnt.executeUntilBlock && currentBlock >= txEnt.executeUntilBlock) {
            await failTransaction(this.rootEm, txEnt.id, `Current ledger ${currentBlock} >= last transaction ledger ${txEnt.executeUntilBlock}`);
            return;
        } else if (txEnt.executeUntilTimestamp && currentTimestamp >= txEnt.executeUntilTimestamp.getTime()) {
            await failTransaction(this.rootEm, txEnt.id, `Current timestamp ${currentTimestamp} >= execute until timestamp ${txEnt.executeUntilTimestamp.getTime()}`);
            return;
        } else if (!txEnt.executeUntilBlock) {
            await updateTransactionEntity(this.rootEm, txEnt.id, async (txEnt) => {
                txEnt.executeUntilBlock = currentBlock + this.blockOffset;
            });
        }

        // TODO: determine how often this should be run - if there will be lots of UTXOs api fetches and updates can become too slow (but do we want to risk inconsistency?)
        await correctUTXOInconsistencies(this.rootEm, txEnt.source, await this.blockchainAPI.getUTXOsWithoutScriptFromMempool(txEnt.source));

        try {
            const transaction = await this.preparePaymentTransaction(txEnt.source, txEnt.destination, txEnt.amount || null, txEnt.fee, txEnt.reference);
            const privateKey = await this.walletKeys.getKey(txEnt.source);

            if (!privateKey) {
                await handleMissingPrivateKey(this.rootEm, txEnt.id);
                return;
            }
            if (checkIfFeeTooHigh(toBN(transaction.getFee()), txEnt.maxFee || null)) {
                await failTransaction(this.rootEm, txEnt.id, `Fee restriction (fee: ${transaction.getFee()}, maxFee: ${txEnt.maxFee?.toString()})`);
            } else {
                // save tx in db
                await updateTransactionEntity(this.rootEm, txEnt.id, async (txEntToUpdate) => {
                    txEntToUpdate.raw = Buffer.from(JSON.stringify(transaction));
                    txEntToUpdate.status = TransactionStatus.TX_PREPARED;
                    txEntToUpdate.reachedStatusPreparedInTimestamp = new Date();
                    txEntToUpdate.fee = toBN(transaction.getFee()); // set the new fee if the original one was null/wrong
                });
                await this.signAndSubmitProcess(txEnt.id, privateKey, transaction);
            }
        } catch (error) {
            if (error instanceof InvalidFeeError) {
                logger.info(`Setting new fee for transaction ${txEnt.id} to ${error.correctFee}`);
                await updateTransactionEntity(this.rootEm, txEnt.id, async (txEntToUpdate) => {
                    txEntToUpdate.fee = error instanceof InvalidFeeError ? error.correctFee : txEntToUpdate.fee; // The check is needed because of the compiler
                });
            } else if (error instanceof NotEnoughUTXOsError) {
                logger.warn(`Not enough UTXOs for transaction ${txEnt.id}, fetching them from mempool`);
                await this.fillUTXOsFromMempool(txEnt.source);
            } else {
                logger.error(`prepareAndSubmitCreatedTransaction failed with: ${errorMessage(error)}`);
            }
            return;
        }

    }

    async checkSubmittedTransaction(txEnt: TransactionEntity): Promise<void> {
        try {
            const txResp = await this.blockchainAPI.getTransaction(txEnt.transactionHash);
            // success
            if (txResp.data.blockHash && txResp.data.confirmations >= this.enoughConfirmations) {
                await updateTransactionEntity(this.rootEm, txEnt.id, async (txEntToUpdate) => {
                    txEntToUpdate.confirmations = txResp.data.confirmations;
                    txEntToUpdate.status = TransactionStatus.TX_SUCCESS;
                    txEntToUpdate.reachedFinalStatusInTimestamp = new Date();
                });
                const core = getCore(this.chainType);
                const tr = new core.Transaction(JSON.parse(txEnt.raw!.toString()));
                const utxos = await fetchUTXOs(this.rootEm, tr.inputs);

                for (const utxo of utxos) {
                    await updateUTXOEntity(this.rootEm, utxo.mintTransactionHash, utxo.position, async (utxoEnt) => {
                        utxoEnt.spentHeight = SpentHeightEnum.SPENT;
                    });
                }
                await createTransactionOutputEntities(this.rootEm, tr, txEnt);
                logger.info(`Transaction ${txEnt.id} (${txEnt.transactionHash}) was accepted`);
                return;
            }
        } catch (error) {
            if (!axios.isAxiosError(error) || isORMError(error)) { // We don't want to fail tx if error is caused by DB
                logger.error(`checkSubmittedTransaction failed with ${errorMessage(error)}`);
                return;
            }
            logger.error(`Transaction ${txEnt.transactionHash} cannot be fetched from node: ${errorMessage(error)}`);
        }
        //TODO handle stuck transactions -> if not accepted in next two block?: could do rbf, but than all dependant will change too!
        const currentBlockHeight = await this.blockchainAPI.getCurrentBlockHeight();
        if (currentBlockHeight - txEnt.submittedInBlock > this.enoughConfirmations) {
            await failTransaction(this.rootEm, txEnt.id, `Not accepted after ${this.enoughConfirmations} blocks`);
        }
    }

    async submitPreparedTransactions(txEnt: TransactionEntity): Promise<void> {
        const core = getCore(this.chainType);
        const transaction = new core.Transaction(JSON.parse(txEnt.raw!.toString()));

        const privateKey = await this.walletKeys.getKey(txEnt.source);
        if (!privateKey) {
            await handleMissingPrivateKey(this.rootEm, txEnt.id);
            return;
        }
        await this.signAndSubmitProcess(txEnt.id, privateKey, transaction);
    }

    async checkPendingTransaction(txEnt: TransactionEntity): Promise<void> {
        await this.waitForTransactionToAppearInMempool(txEnt.id);
    }

    async signAndSubmitProcess(txId: number, privateKey: string, transaction: bitcore.Transaction): Promise<void> {
        let signed = { txBlob: "", txHash: "" }; //TODO do it better
        try {
            signed = await this.signTransaction(transaction, privateKey);
            // save tx in db
            await updateTransactionEntity(this.rootEm, txId, async (txEnt) => {
                txEnt.transactionHash = signed.txHash;
            });
        } catch (error: any) {
            if (isORMError(error)) { // We don't want to fail tx if error is caused by DB
                logger.error(`signAndSubmitProcess failed with DB error: ${errorMessage(error)}`);
                return;
            }
            await failTransaction(this.rootEm, txId, `Cannot sign transaction ${txId}: ${errorMessage(error)}`, error);
            return;
        }
        // submit
        const txStatus = await this.submitTransaction(signed.txBlob, txId);
        const txEnt = await fetchTransactionEntityById(this.rootEm, txId);
        if (txStatus == TransactionStatus.TX_PENDING) {
            await updateTransactionEntity(this.rootEm, txEnt.id, async (txEntToUpdate) => {
                txEntToUpdate.reachedStatusPendingInTimestamp = new Date();
            });
            await this.waitForTransactionToAppearInMempool(txEnt.id, 0);
        }
    }

    /**
     * @param {string} source
     * @param {string} destination
     * @param {BN|null} amountInSatoshi - if null => empty all funds
     * @param {BN|undefined} feeInSatoshi - automatically set if undefined
     * @param {string|undefined} note
     * @param {BN|undefined} maxFeeInSatoshi
     * @returns {Object} - BTC/DOGE transaction object
     */
    private async preparePaymentTransaction(
        source: string,
        destination: string,
        amountInSatoshi: BN | null,
        feeInSatoshi?: BN,
        note?: string,
    ): Promise<bitcore.Transaction> {
        const isPayment = amountInSatoshi != null;
        const core = getCore(this.chainType);
        const utxos = await this.fetchUTXOs(source, amountInSatoshi, feeInSatoshi, getEstimatedNumberOfOutputs(amountInSatoshi, note));


        if (amountInSatoshi == null) {
            feeInSatoshi = await getEstimateFee(this, utxos.length);
            amountInSatoshi = (await this.getAccountBalance(source)).sub(feeInSatoshi);
        }

        const utxosAmount = utxos.reduce((accumulator, transaction) => {
            return accumulator + transaction.satoshis;
        }, 0);

        if (amountInSatoshi.lte(getDustAmount(this.chainType))) {
            throw new Error(
                `Will not prepare transaction for ${source}. Amount ${amountInSatoshi.toString()} is less than dust ${getDustAmount(this.chainType).toString()}`,
            );
        }
        if (toBN(utxosAmount).sub(amountInSatoshi).lten(0)) {
            throw new NotEnoughUTXOsError(`Not enough UTXOs for creating transaction.`);
        }

        const tr = new core.Transaction().from(utxos.map((utxo) => new UnspentOutput(utxo))).to(destination, toNumber(amountInSatoshi));
        if (isPayment) {
            tr.change(source);
        }
        if (note) {
            tr.addData(Buffer.from(unPrefix0x(note), "hex"));
        }
        tr.enableRBF();
        if (feeInSatoshi) {
            const bitcoreEstFee = toBN(tr.getFee());
            if (hasTooHighOrLowFee(this.chainType, feeInSatoshi, bitcoreEstFee)) {
                const estFee = await getEstimateFee(this, tr.inputs.length, tr.outputs.length);
                const correctFee = hasTooHighOrLowFee(this.chainType, estFee, bitcoreEstFee) ? toBN(bitcoreEstFee) : estFee;
                throw new InvalidFeeError(
                    `Provided fee ${feeInSatoshi.toNumber()} fails bitcore serialization checks! bitcoreEstFee: ${bitcoreEstFee}, estFee: ${estFee.toNumber()}`,
                    correctFee,
                );
            }
            tr.fee(toNumber(feeInSatoshi));
        }
        if (isPayment && !feeInSatoshi) {
            const feeRatePerKB = await getFeePerKB(this);
            tr.feePerKb(Number(feeRatePerKB));
        }
        return tr;
    }

    /**
     * @param {Object} transaction
     * @param {string} privateKey
     * @returns {string} - hex string
     */
    private async signTransaction(transaction: bitcore.Transaction, privateKey: string): Promise<SignedObject> {
        const signedAndSerialized = transaction.sign(privateKey).toString();
        const txId = transaction.id;
        return { txBlob: signedAndSerialized, txHash: txId };
    }

    /**
     * @param {string} signedTx
     */
    private async submitTransaction(signedTx: string, txId: number): Promise<TransactionStatus> {
        // check if there is still time to submit
        const transaction = await fetchTransactionEntityById(this.rootEm, txId);
        const currentBlockHeight = await this.blockchainAPI.getCurrentBlockHeight();
        const currentTimestamp = new Date().getTime();

        if (transaction.executeUntilBlock && transaction.executeUntilBlock - currentBlockHeight < this.executionBlockOffset) {
            await failTransaction(this.rootEm, txId, `Transaction ${txId} has no time left to be submitted: currentBlockHeight: ${currentBlockHeight}, executeUntilBlock: ${transaction.executeUntilBlock}, offset ${this.executionBlockOffset}`);
            return TransactionStatus.TX_FAILED;
        } else if (transaction.executeUntilTimestamp && currentTimestamp >= transaction.executeUntilTimestamp.getTime()) {
            await failTransaction(this.rootEm, transaction.id, `Current timestamp ${currentTimestamp} >= execute until timestamp ${transaction.executeUntilTimestamp}`);
            return TransactionStatus.TX_FAILED;
        } else if (!transaction.executeUntilBlock) {
            logger.warn(`Transaction ${txId} does not have 'executeUntilBlock' defined`);
        }
        try {
            const resp = await this.blockchainAPI.sendTransaction(signedTx);
            if (resp.status == 200) {
                const submittedBlockHeight = await this.blockchainAPI.getCurrentBlockHeight();
                await updateTransactionEntity(this.rootEm, txId, async (txEnt) => {
                    txEnt.status = TransactionStatus.TX_PENDING;
                    txEnt.submittedInBlock = submittedBlockHeight;
                    txEnt.submittedInTimestamp = new Date();
                    txEnt.reachedStatusPendingInTimestamp = new Date();
                });
                await this.updateTransactionInputSpentStatus(txId, SpentHeightEnum.SENT);
                return TransactionStatus.TX_PENDING;
            } else {
                await failTransaction(this.rootEm, txId, `Transaction ${txId} submission failed ${resp.status}`, resp.data);
                await this.updateTransactionInputSpentStatus(txId, SpentHeightEnum.UNSPENT);
                return TransactionStatus.TX_FAILED;
            }
        } catch (error: any) {
            if (isORMError(error)) { // We don't want to fail tx if error is caused by DB
                logger.error(`submitTransaction failed with DB error: ${errorMessage(error)}`);
                return TransactionStatus.TX_PREPARED;
            } else if (axios.isAxiosError(error)) {
                logger.error(`submitTransaction failed with Axios error (${error.response?.data?.error}): ${errorMessage(error)}`);
                if (error.response?.data?.error?.indexOf("too-long-mempool-chain") >= 0) {
                    logger.error(`too-long-mempool-chain`, error);
                    return TransactionStatus.TX_PREPARED;
                } else if (error.response?.data?.error?.indexOf("transaction already in block chain") >= 0) {
                    return TransactionStatus.TX_PENDING;
                }
                return TransactionStatus.TX_PREPARED;
            }

            // TODO in case of network problems
            await failTransaction(this.rootEm, txId, `Transaction ${txId} submission failed ${errorMessage(error)}`, error);
            await this.updateTransactionInputSpentStatus(txId, SpentHeightEnum.UNSPENT);
            return TransactionStatus.TX_FAILED;
        }
    }

    /**
     * Retrieves unspent transactions in format accepted by transaction
     * @param {string} address
     * @param {BN|null} amountInSatoshi - if null => empty all funds
     * @param feeInSatoshi
     * @param {number} estimatedNumOfOutputs
     * @returns {Object[]}
     */
    async fetchUTXOs(address: string, amountInSatoshi: BN | null, feeInSatoshi: BN | undefined, estimatedNumOfOutputs: number): Promise<UTXO[]> {
        const utxos = await this.listUnspent(address, amountInSatoshi, feeInSatoshi, estimatedNumOfOutputs);
        const allUTXOs: UTXO[] = [];

        for (const utxo of utxos) {
            if (!utxo.script || utxo.script.length < 1) {
                utxo.script = await this.blockchainAPI.getUTXOScript(address, utxo.mintTransactionHash, utxo.position);
                await updateUTXOEntity(this.rootEm, utxo.mintTransactionHash, utxo.position, utxoEnt => utxoEnt.script = utxo.script);
            }
            const item = {
                txid: utxo.mintTransactionHash,
                satoshis: Number(utxo.value),
                outputIndex: utxo.position,
                confirmations: -1,
                scriptPubKey: utxo.script,
            };
            allUTXOs.push(item);
        }
        return allUTXOs;
    }

    private async updateTransactionInputSpentStatus(txId: number, status: SpentHeightEnum) {
        const txEnt = await fetchTransactionEntityById(this.rootEm, txId);
        const transaction = JSON.parse(txEnt.raw!.toString());
        for (const input of transaction.inputs) {
            await updateUTXOEntity(this.rootEm, input.prevTxId.toString("hex"), input.outputIndex, async (utxoEnt) => {
                utxoEnt.spentHeight = status;
            });
        }
    }

    /**
     * Retrieves unspent transactions
     * @param {string} address
     * @param {BN|null} amountInSatoshi - if null => empty all funds
     * @param feeInSatoshi
     * @param {number} estimatedNumOfOutputs
     * @returns {Object[]}
     */
    private async listUnspent(address: string, amountInSatoshi: BN | null, feeInSatoshi: BN | undefined, estimatedNumOfOutputs: number): Promise<any[]> {
        // fetch db utxos
        logger.info(`Listing UTXOs for address ${address}`);
        let dbUTXOS = await fetchUnspentUTXOs(this.rootEm, address);
        // fill from mempool and refetch
        if (dbUTXOS.length == 0) {
            await this.fillUTXOsFromMempool(address);
            dbUTXOS = await fetchUnspentUTXOs(this.rootEm, address);
        }
        if (amountInSatoshi == null) {
            return dbUTXOS;
        }

        const needed = await this.returnNeededUTXOs(dbUTXOS, estimatedNumOfOutputs, amountInSatoshi, feeInSatoshi);
        if (needed) {
            return needed;
        }
        // not enough funds in db
        await this.fillUTXOsFromMempool(address);
        dbUTXOS = await fetchUnspentUTXOs(this.rootEm, address);
        const neededAfter = await this.returnNeededUTXOs(dbUTXOS, estimatedNumOfOutputs, amountInSatoshi, feeInSatoshi);
        if (neededAfter) {
            return neededAfter;
        }
        return dbUTXOS;
    }

    private async returnNeededUTXOs(allUTXOS: UTXOEntity[], estimatedNumOfOutputs: number, amountInSatoshi: BN, feeInSatoshi?: BN): Promise<UTXOEntity[] | null> {
        feeInSatoshi = feeInSatoshi ?? toBN(0);

        const neededUTXOs = [];
        let sum = 0;
        for (const utxo of allUTXOS) {
            const numAncestors = await getNumberOfAncestorsInMempool(this, utxo.mintTransactionHash);
            if (numAncestors >= this.mempoolChainLengthLimit) {
                logger.info(`numAncestors ${numAncestors} > ${this.mempoolChainLengthLimit}`);
                continue;
            }
            neededUTXOs.push(utxo);
            const value = Number(utxo.value);
            sum += value;
            const est_fee = await getEstimateFee(this, neededUTXOs.length, estimatedNumOfOutputs);
            // multiply estimated fee by 2 to ensure enough funds TODO: is it enough?
            if (toBN(sum).gt(amountInSatoshi.add(max(est_fee, feeInSatoshi).muln(2)))) {
                return neededUTXOs;
            }
        }
        return null;
    }

    private async fillUTXOsFromMempool(address: string) {
        const utxos = await this.blockchainAPI.getUTXOsFromMempool(address);
        await storeUTXOS(this.rootEm, address, utxos);
    }

    private async waitForTransactionToAppearInMempool(txId: number, retry: number = 0): Promise<void> {
        const txEnt = await fetchTransactionEntityById(this.rootEm, txId);
        const start = txEnt.submittedInTimestamp!.getTime();
        do {
            try {
                const txResp = await this.blockchainAPI.getTransaction(txEnt.transactionHash);
                if (txResp) {
                    await updateTransactionEntity(this.rootEm, txId, async (txEnt) => {
                        txEnt.status = TransactionStatus.TX_SUBMITTED;
                        txEnt.acceptedToMempoolInTimestamp = new Date();
                    });
                    return;
                }
            } catch (e) {
                if (axios.isAxiosError(e)) {
                    const responseData = e.response?.data;
                    logger.warn(`Transaction ${txId} not yet seen in mempool`, responseData);
                } else {
                    logger.warn(`Transaction ${txId} not yet seen in mempool`, e);
                }
                await sleepMs(1000);
            }
        } while (new Date().getTime() - start < this.mempoolWaitingTime);

        // transaction was not accepted in mempool by one minute => replace by fee one time
        if (retry > 0) {
            await failTransaction(this.rootEm, txId, `Transaction ${txId} was not accepted in mempool`);
        } else {
            if (!(await checkIfShouldStillSubmit(this, txEnt.executeUntilBlock, txEnt.executeUntilTimestamp?.getTime()))) {
                const currentBlock = await this.blockchainAPI.getCurrentBlockHeight();
                await failTransaction(this.rootEm, txId, `Current ledger ${currentBlock} >= last transaction ledger ${txEnt.executeUntilBlock}`);
            }
            //TODO fail for now
            //await this.tryToReplaceByFee(txHash);
            await failTransaction(this.rootEm, txId, `Need to implement rbf`);
        }
    }

    private async tryToReplaceByFee(txHash: string): Promise<ISubmitTransactionResponse> {
        throw new Error(`Cannot replaceByFee transaction ${txHash}.`);
        // const retryTx = await fetchTransactionEntity(this.rootEm, txHash);
        // const newTransaction = JSON.parse(retryTx.raw.toString());
        // const newFee = newTransaction.getFee() * this.feeIncrease;
        // if (this.checkIfFeeTooHigh(toBN(newFee), retryTx.maxFee)) {
        //     await updateTransactionEntity(this.rootEm, txHash, async (txEnt) => {
        //         txEnt.status = TransactionStatus.TX_FAILED;
        //     });
        //     throw new Error(`Transaction ${txHash} failed due to fee restriction`);
        // }
        // const privateKey = ""; //TODO fetch private key from
        // const blob = await this.signTransaction(newTransaction, privateKey);
        // const submitResp = await this.submitTransaction(blob);
        // const submittedBlockHeight = await this.blockchainAPI.getCurrentBlockHeight();
        // await createInitialTransactionEntity(this.rootEm, newTransaction, retryTx.source, retryTx.destination, submitResp.txId, submittedBlockHeight, retryTx.maxFee);
        // const newTxEnt = await fetchTransactionEntity(this.rootEm, submitResp.txId);
        // await updateTransactionEntity(this.rootEm, txHash, async (txEnt) => {
        //     txEnt.replaced_by = newTxEnt;
        //     txEnt.status = TransactionStatus.TX_REPLACED;
        // });
        // await this.waitForTransactionToAppearInMempool(submitResp.txId, 1);
        // return submitResp;
    }

    /**
     * @param {number} dbId
     * @returns {Object} - containing transaction info
     */
    async getTransactionInfo(dbId: number): Promise<TransactionInfo> {
        return await getTransactionInfoById(this.rootEm, dbId);
    }
}