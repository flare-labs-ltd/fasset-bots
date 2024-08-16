import axios, { AxiosInstance, AxiosRequestConfig } from "axios";
import axiosRateLimit from "../axios-rate-limiter/axios-rate-limit";
import elliptic from "elliptic";
import xrpl, { convertStringToHex, encodeForSigning, encode as xrplEncode, hashes as xrplHashes } from "xrpl"; // package has some member access issues
// eslint-disable-next-line @typescript-eslint/no-var-requires
const xrpl__typeless = require("xrpl");
import { deriveAddress, sign } from "ripple-keypairs";
import { excludeNullFields, sleepMs, bytesToHex, prefix0x, stuckTransactionConstants, isValidHexString, checkIfFeeTooHigh } from "../utils/utils";
import { toBN } from "../utils/bnutils";
import { ChainType, DEFAULT_RATE_LIMIT_OPTIONS_XRP, DELETE_ACCOUNT_OFFSET } from "../utils/constants";
import type { AccountInfoRequest, AccountInfoResponse } from "xrpl";
import type {
   ICreateWalletResponse,
   WriteWalletInterface,
   RippleWalletConfig,
   XRPFeeParams,
   SignedObject,
   TransactionInfo,
   IWalletKeys,
} from "../interfaces/WalletTransactionInterface";
import BN from "bn.js";
import {
   updateTransactionEntity,
   createInitialTransactionEntity,
   getTransactionInfoById,
   fetchTransactionEntityById,
   failTransaction,
   handleMissingPrivateKey,
   processTransactions,
   checkIfIsDeleting,
   setAccountIsDeleting,
} from "../db/dbutils";

const ed25519 = new elliptic.eddsa("ed25519");
const secp256k1 = new elliptic.ec("secp256k1");

import { logger } from "../utils/logger";
import { XrpAccountGeneration } from "./account-generation/XrpAccountGeneration";
import { TransactionStatus, TransactionEntity } from "../entity/transaction";
import { EntityManager, RequiredEntityData } from "@mikro-orm/core";
import { fetchMonitoringState, updateMonitoringState } from "../utils/lockManagement";
import { MonitoringStateEntity } from "../entity/monitoring_state";

const DROPS_PER_XRP = 1000000.0;

export class XrpWalletImplementation extends XrpAccountGeneration implements WriteWalletInterface {
   chainType: ChainType;
   inTestnet: boolean;
   client: AxiosInstance;
   blockOffset: number; // number of blocks added to define executeUntilBlock (only if not provided in original data)
   feeIncrease: number;
   executionBlockOffset: number; //buffer before submitting -> will submit only if (currentLedger - executeUntilBlock) >= executionBlockOffset
   rootEm!: EntityManager;
   walletKeys!: IWalletKeys;

   monitoring: boolean = false;
   executionTimestampOffset: number = 10; //TODO

   restartInDueToError: number = 2000; //2s
   restartInDueNoResponse: number = 20000; //20s

   constructor(createConfig: RippleWalletConfig) {
      super(createConfig.inTestnet ?? false);
      this.inTestnet = createConfig.inTestnet ?? false;

      this.chainType = this.inTestnet ? ChainType.testXRP : ChainType.XRP;

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
         timeout: createConfig.rateLimitOptions?.timeoutMs ?? DEFAULT_RATE_LIMIT_OPTIONS_XRP.timeoutMs,
         validateStatus: function (status: number) {
            /* istanbul ignore next */
            return (status >= 200 && status < 300) || status == 500;
         },
      };
      // don't need rpc auth as we are always sending signed transactions
      const client = axios.create(createAxiosConfig);
      this.client = axiosRateLimit(client, {
         ...DEFAULT_RATE_LIMIT_OPTIONS_XRP,
         ...createConfig.rateLimitOptions,
      });
      const resubmit = stuckTransactionConstants(this.chainType);
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      this.blockOffset = createConfig.stuckTransactionOptions?.blockOffset ?? resubmit.blockOffset!;
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      this.feeIncrease = createConfig.stuckTransactionOptions?.feeIncrease ?? resubmit.feeIncrease!;
      this.executionBlockOffset = createConfig.stuckTransactionOptions?.executionBlockOffset ?? resubmit.executionBlockOffset!;
      this.rootEm = createConfig.em;
      this.walletKeys = createConfig.walletKeys;
   }

   /**
    * @param {string} account
    * @returns {BN} - balance in drops
    */
   async getAccountBalance(account: string): Promise<BN> {
      try {
         const data = await this.getAccountInfo(account);
         logger.info(`Get account balance for ${account}`, data.result);
         return toBN(data.result.account_data?.Balance || 0);
      } catch (error) {
         logger.error(`Cannot get account balance for ${account}`, error);
         throw error;
      }
   }

   /**
    * @param {XRPFeeParams} params - differentiate between Payment and AccountDelete transaction types
    * @returns {BN} - current transaction/network fee in drops
    */
   async getCurrentTransactionFee(params: XRPFeeParams): Promise<BN> {
      //https://xrpl.org/transaction-cost.html#server_info
      const serverInfo = (await this.getServerInfo()).result.info;
      /* istanbul ignore next */
      // AccountDelete: transaction must pay a special transaction cost equal to at least the owner reserve for one item (currently 2 XRP).
      // https://xrpl.org/docs/concepts/accounts/reserves
      let baseFee = params.isPayment ? serverInfo.validated_ledger?.base_fee_xrp : serverInfo.validated_ledger?.reserve_inc_xrp;
      /* istanbul ignore if */
      if (!baseFee) {
         throw Error("Could not get base_fee_xrp from server_info");
      }
      /* istanbul ignore next */
      if (params.isPayment && serverInfo.load_factor) {
         baseFee *= serverInfo.load_factor;
      }
      return toBN(xrpl__typeless.xrpToDrops(this.roundUpXrpToDrops(baseFee)));
   }

   /**
    * @param {string} source
    * @param {string} privateKey
    * @param {string} destination
    * @param {BN|null} amountInDrops - if null => AccountDelete transaction will be created
    * @param {BN|undefined} feeInDrops - automatically set if undefined
    * @param {string|undefined} note
    * @param {BN|undefined} maxFeeInDrops
    * @returns {Object} - containing transaction id tx_id and optional result
    */
   async createPaymentTransaction(
      source: string,
      privateKey: string,
      destination: string,
      amountInDrops: BN | null,
      feeInDrops?: BN,
      note?: string,
      maxFeeInDrops?: BN,
      executeUntilBlock?: number,
      executeUntilTimestamp?: number
   ): Promise<number> {
      logger.info(`Received request to create tx from ${source} to ${destination} with amount ${amountInDrops} and reference ${note}`);
      if (await checkIfIsDeleting(this.rootEm, source)) {
         logger.error(`Cannot receive requests. ${source} is deleting`);
         console.error(`Cannot receive requests. ${source} is deleting`);
         throw new Error(`Cannot receive requests. ${source} is deleting`);
      }
      await this.walletKeys.addKey(source, privateKey);
      const ent = await createInitialTransactionEntity(
         this.rootEm,
         this.chainType,
         source,
         destination,
         amountInDrops,
         feeInDrops,
         note,
         maxFeeInDrops,
         executeUntilBlock,
         executeUntilTimestamp
      );
      const txExternalId = ent.id;
      return txExternalId;
   }

   /**
    * @param {string} source
    * @param {string} privateKey
    * @param {string} destination
    * @param {BN|undefined} feeInDrops - automatically set if undefined
    * @param {string|undefined} note
    * @param {BN|undefined} maxFeeInDrops
    * @param {number|undefined} sequence
    * @returns {Object} - containing transaction id tx_id and optional result
    */
   async createDeleteAccountTransaction(
      source: string,
      privateKey: string,
      destination: string,
      feeInDrops?: BN,
      note?: string,
      maxFeeInDrops?: BN,
      executeUntilBlock?: number,
      executeUntilTimestamp?: number
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
         feeInDrops,
         note,
         maxFeeInDrops,
         executeUntilBlock,
         executeUntilTimestamp
      );
      const txExternalId = ent.id;
      return txExternalId;
   }

   /**
    * @param {number} dbId
    * @returns {Object} - containing transaction info
    */
   async getTransactionInfo(dbId: number): Promise<TransactionInfo> {
      return await getTransactionInfoById(this.rootEm, dbId);
   }

   ///////////////////////////////////////////////////////////////////////////////////////
   // MONITORING /////////////////////////////////////////////////////////////////////////
   ///////////////////////////////////////////////////////////////////////////////////////

   isMonitoring(): boolean {
      return this.monitoring === true;
   }

   stopMonitoring(): void {
      this.monitoring = false;
   }

   /**
    * Background processing
    */
   async startMonitoringTransactionProgress(): Promise<void> {
      try {
         const monitoringState = await fetchMonitoringState(this.rootEm, this.chainType);
         if (!monitoringState) {
            this.rootEm.create(MonitoringStateEntity, { chainType: this.chainType, isMonitoring: true } as RequiredEntityData<MonitoringStateEntity>,);
            await this.rootEm.flush();
            this.monitoring = true;
         } else if (monitoringState.isMonitoring) {
            logger.info(`Monitoring for chain ${this.chainType} is already running.`);
            return;
         } else {
            await updateMonitoringState(this.rootEm, this.chainType, async (monitoringEnt) => {
               monitoringEnt.isMonitoring = true;
            });
            this.monitoring = true;
         }
         logger.info(`Monitoring started for chain ${this.chainType}`);
         console.info(`Monitoring started for chain ${this.chainType}`);

         while (this.monitoring) {
            try {
               const networkUp = await this.checkXrpNetworkStatus();
               if (!networkUp) {
                  logger.error(`Trying again in ${this.restartInDueNoResponse}`);
                  await sleepMs(this.restartInDueNoResponse);
                  continue;
               }

               await processTransactions(this.rootEm, this.chainType, TransactionStatus.TX_PREPARED, this.submitPreparedTransactions.bind(this));
               if (this.shouldStopMonitoring()) break;
               await processTransactions(this.rootEm, this.chainType, TransactionStatus.TX_SUBMISSION_FAILED, this.resubmitSubmissionFailedTransactions.bind(this));
               if (this.shouldStopMonitoring()) break;
               await processTransactions(this.rootEm, this.chainType, TransactionStatus.TX_PENDING, this.resubmitPendingTransaction.bind(this));
               if (this.shouldStopMonitoring()) break;
               await processTransactions(this.rootEm, this.chainType, TransactionStatus.TX_CREATED, this.prepareAndSubmitCreatedTransaction.bind(this));
               if (this.shouldStopMonitoring()) break;
               await processTransactions(this.rootEm, this.chainType, TransactionStatus.TX_SUBMITTED, this.checkSubmittedTransaction.bind(this));
               if (this.shouldStopMonitoring()) break;
            } catch (error) {
               logger.error(`Monitoring run into error. Restarting in ${this.restartInDueToError}`, error);
            }
            await sleepMs(this.restartInDueToError);
            if (this.shouldStopMonitoring()) {
               break;
            }
         }
      } finally {
         this.monitoring = false;
         await updateMonitoringState(this.rootEm, this.chainType, async (monitoringEnt) => {
            monitoringEnt.isMonitoring = false;
         });
         logger.info(`Monitoring stopped for chain ${this.chainType} stopped.`);
      }
   }

   shouldStopMonitoring() {
      if (!this.monitoring) {
         logger.info(`Monitoring should be stopped for chain ${this.chainType}`);
         console.info(`Monitoring should be stopped for chain ${this.chainType}`);
         return true;
      }
      return false;
   }

   async checkXrpNetworkStatus(): Promise<boolean> {
      //TODO - maybe can be more robust if also take into account response
      try {
         await this.getServerInfo();
         return true;
      } catch (error) {
         logger.error("Cannot ger response from server", error);
         return false;
      }
   }

   ///////////////////////////////////////////////////////////////////////////////////////
   // HELPER OR CLIENT SPECIFIC FUNCTIONS ////////////////////////////////////////////////
   ///////////////////////////////////////////////////////////////////////////////////////
   async resubmitSubmissionFailedTransactions(tx: TransactionEntity): Promise<void> {
      const transaction = JSON.parse(tx.raw!.toString());
      const privateKey = await this.walletKeys.getKey(tx.source);
      if (!privateKey) {
         await handleMissingPrivateKey(this.rootEm, tx.id);
         return;
      }
      const newFee = toBN(transaction.Fee!).muln(this.feeIncrease);
      await this.resubmitTransaction(tx.id, privateKey, transaction, newFee);
   }

   async resubmitPendingTransaction(tx: TransactionEntity): Promise<void> {
      const transaction = JSON.parse(tx.raw!.toString());
      const privateKey = await this.walletKeys.getKey(tx.source);
      if (!privateKey) {
         await handleMissingPrivateKey(this.rootEm, tx.id);
         return;
      }

      if (!await this.checkIfTransactionAppears(tx.id)) {
         const newFee = toBN(transaction.Fee!);
         await this.resubmitTransaction(tx.id, privateKey, transaction, newFee);
      }
   }

   async submitPreparedTransactions(tx: TransactionEntity): Promise<void> {
      const transaction = JSON.parse(tx.raw!.toString());
      const privateKey = await this.walletKeys.getKey(tx.source);
      if (!privateKey) {
         await handleMissingPrivateKey(this.rootEm, tx.id);
         return;
      }
      await this.signAndSubmitProcess(tx.id, privateKey, transaction);
   }

   async prepareAndSubmitCreatedTransaction(tx: TransactionEntity): Promise<void> {
      const currentLedger = await this.getLatestValidatedLedgerIndex();
      if (tx.executeUntilBlock && currentLedger >= tx.executeUntilBlock) {
         await failTransaction(this.rootEm, tx.id, `Current ledger ${currentLedger} >= last transaction ledger ${tx.executeUntilBlock}`);
         return;
      }
      //prepare
      const transaction = await this.preparePaymentTransaction(
         tx.source,
         tx.destination,
         tx.amount || null,
         tx.fee,
         tx.reference,
         tx.executeUntilBlock
      );
      const privateKey = await this.walletKeys.getKey(tx.source);
      if (!privateKey) {
         await handleMissingPrivateKey(this.rootEm, tx.id);
         return;
      }
      if (checkIfFeeTooHigh(toBN(transaction.Fee!), tx.maxFee || null)) {
         await failTransaction(this.rootEm, tx.id, `Fee restriction (fee: ${transaction.Fee}, maxFee: ${tx.maxFee?.toString()})`);
      } else {
         // save tx in db
         await updateTransactionEntity(this.rootEm, tx.id, async (txEnt) => {
            txEnt.raw = Buffer.from(JSON.stringify(transaction));
            txEnt.executeUntilBlock = transaction.LastLedgerSequence;
            txEnt.status = TransactionStatus.TX_PREPARED;
            txEnt.reachedStatusPreparedInTimestamp = new Date().getTime();
         });
         await this.signAndSubmitProcess(tx.id, privateKey, transaction);
      }
   }

   async checkSubmittedTransaction(tx: TransactionEntity): Promise<void> {
      const txResp = await this.client.post("", { method: "tx", params: [{ transaction: tx.transactionHash }] });
      if (txResp.data.result.validated) {
         await updateTransactionEntity(this.rootEm, tx.id, async (txEnt) => {
            txEnt.status = TransactionStatus.TX_SUCCESS;
            txEnt.reachedFinalStatusInTimestamp = new Date().getTime();
         });
         logger.info(`Transaction ${tx.id} was accepted`);
         console.info(`Transaction ${tx.id} was accepted`);
      } else {
         const currentLedger = await this.getLatestValidatedLedgerIndex();
         if (tx.executeUntilBlock && currentLedger >= tx.executeUntilBlock) {
            await failTransaction(this.rootEm, tx.id, `Current ledger ${currentLedger} >= last transaction ledger ${tx.executeUntilBlock}`);
            //TODO sanity check [Account Sequence is less than or equal to transaction Sequence] => all good
         }
      }
   }

   async signAndSubmitProcess(txId: number, privateKey: string, transaction: xrpl.Payment | xrpl.AccountDelete): Promise<void> {
      const signed = await this.signTransaction(transaction, privateKey);
      // save tx in db
      await updateTransactionEntity(this.rootEm, txId, async (txEnt) => {
         txEnt.transactionHash = signed.txHash;
      });
      const txStatus = await this.submitTransaction(signed.txBlob, txId);
      // resubmit with higher fee
      if (txStatus == TransactionStatus.TX_SUBMISSION_FAILED) {
         const newFee = toBN(transaction.Fee!).muln(this.feeIncrease);
         await this.resubmitTransaction(txId, privateKey, transaction, newFee);
      }
      if (txStatus == TransactionStatus.TX_PENDING) {
         await updateTransactionEntity(this.rootEm, txId, async (txEnt) => {
            txEnt.reachedStatusPendingInTimestamp = new Date().getTime();
         })
         if (await this.checkIfTransactionAppears(txId)) {
            return
         }
         // tx did not show up => resubmit with the same data
         const newFee = toBN(transaction.Fee!);
         await this.resubmitTransaction(txId, privateKey, transaction, newFee);
      }
   }

   async checkIfTransactionAppears(txId: number) {
      // wait if tx shows up in next x blocks
      const txEnt = await fetchTransactionEntityById(this.rootEm, txId);
      const waitUntilBlock = txEnt.submittedInBlock + this.blockOffset;
      do {
         const txResp = await this.client.post("", {
            method: "tx",
            params: [{transaction: txEnt.transactionHash}],
         });
         if (txResp.data.result.validated) {
            // transaction completed - update tx in db
            await updateTransactionEntity(this.rootEm, txId, async (txEnt) => {
               txEnt.status = TransactionStatus.TX_SUCCESS;
               txEnt.reachedFinalStatusInTimestamp = new Date().getTime();
            });
            logger.info(`Transaction ${txId} was accepted`);
            console.info(`Transaction ${txId} was accepted`);
            return true;
         }
      } while ((await this.getLatestValidatedLedgerIndex()) <= waitUntilBlock);
      return false;
   }

   async resubmitTransaction(txId: number, privateKey: string, transaction: xrpl.Payment | xrpl.AccountDelete, newFee: BN) {
      const origTx = await fetchTransactionEntityById(this.rootEm, txId);
      if (checkIfFeeTooHigh(newFee, origTx.maxFee || null)) {
         await failTransaction(this.rootEm, txId, `Cannot resubmit transaction ${txId}. Due to fee restriction (fee: ${newFee}, maxFee: ${origTx.maxFee?.toString()})`);
      } else {
         const originalTx = await fetchTransactionEntityById(this.rootEm, txId);
         const newTransaction = transaction;
         newTransaction.Fee = newFee.toString();
         // store tx + update previous one
         const resubmittedTx = await createInitialTransactionEntity(
            this.rootEm,
            this.chainType,
            originalTx.source,
            originalTx.destination,
            originalTx.amount || null,
            newFee,
            originalTx.reference,
            originalTx.maxFee,
            originalTx.executeUntilBlock,
            originalTx.executeUntilTimestamp
         );
         await updateTransactionEntity(this.rootEm, txId, async (txEnt) => {
            txEnt.status = TransactionStatus.TX_REPLACED;
            txEnt.replaced_by = resubmittedTx;
            txEnt.reachedFinalStatusInTimestamp = new Date().getTime();
         });
         const signed = await this.signTransaction(newTransaction, privateKey);
         const currentBlockHeight = await this.getLatestValidatedLedgerIndex();
         // save tx in db
         await updateTransactionEntity(this.rootEm, resubmittedTx.id, async (txEnt) => {
            txEnt.raw = Buffer.from(JSON.stringify(transaction));
            txEnt.transactionHash = signed.txHash;
            txEnt.submittedInBlock = currentBlockHeight;
            txEnt.executeUntilBlock = transaction.LastLedgerSequence;//TODO
         });
         await this.submitTransaction(signed.txBlob, resubmittedTx.id, 1);
      }
   }

   /**
    * @param {string} source
    * @param {string} destination
    * @param {BN|null} amountInDrops - if null => AccountDelete transaction will be created
    * @param {BN|undefined} feeInDrops - automatically set if undefined
    * @param {string|undefined} note
    * @param {BN|undefined} maxFeeInDrops
    * @returns {Object} - XRP Payment or AccountDelete transaction object
    */
   async preparePaymentTransaction(
      source: string,
      destination: string,
      amountInDrops: BN | null,
      feeInDrops?: BN,
      note?: string,
      executeUntilBlock?: number
   ): Promise<xrpl.Payment | xrpl.AccountDelete> {
      const isPayment = amountInDrops != null;
      let tr;
      if (isPayment) {
         tr = {
            TransactionType: "Payment",
            Destination: destination.toString(),
            Amount: amountInDrops.toString(),
            Account: source,
         } as xrpl.Payment;
      } else {
         tr = {
            TransactionType: "AccountDelete",
            Destination: destination.toString(),
            Account: source,
         } as xrpl.AccountDelete;
      }

      tr.Sequence = await this.getAccountSequence(source);
      if (!feeInDrops) {
         tr.Fee = (await this.getCurrentTransactionFee({ isPayment })).toString();
      } else {
         tr.Fee = feeInDrops.toString();
      }
      if (note) {
         const noteHex = isValidHexString(prefix0x(note)) ? note : convertStringToHex(note);
         const Memo = { Memo: { MemoData: noteHex } };
         tr.Memos = [Memo];
      }
      // Highest ledger index this transaction can appear in. https://xrpl.org/reliable-transaction-submission.html#lastledgersequence
      const latestBlock = await this.getLatestValidatedLedgerIndex();
      tr.LastLedgerSequence = executeUntilBlock ? executeUntilBlock : latestBlock + this.blockOffset;
      // In order to be allowed to delete account, following is required. https://xrpl.org/docs/concepts/accounts/deleting-accounts/#requirements
      if (!isPayment) {
         tr.LastLedgerSequence = Math.max(tr.Sequence + DELETE_ACCOUNT_OFFSET, latestBlock) + this.blockOffset;
      }
      return tr;
   }

   /**
    * @param {Object} transaction
    * @param {string} privateKey
    * @returns {string}
    */
   async signTransaction(transaction: xrpl.Transaction, privateKey: string): Promise<SignedObject> {
      const publicKey = this.getPublicKeyFromPrivateKey(privateKey, transaction.Account);
      const transactionToSign = { ...transaction };
      transactionToSign.SigningPubKey = publicKey;
      transactionToSign.TxnSignature = sign(encodeForSigning(transactionToSign), privateKey);
      const serialized = xrplEncode(transactionToSign);
      const hash = xrplHashes.hashSignedTx(serialized);
      return { txBlob: serialized, txHash: hash };
   }

   /**
    * @param {string} txBlob
    * @param {number} txDbId
    * @returns {boolean} - should replace fn or not; replace in case insufficient fee
    */
   async submitTransaction(txBlob: string, txDbId: number, retry: number = 0): Promise<TransactionStatus> {
      // check if there is still time to submit
      const transaction = await fetchTransactionEntityById(this.rootEm, txDbId);
      const currentLedger = await this.getLatestValidatedLedgerIndex();
      if (transaction.executeUntilBlock && transaction.executeUntilBlock - currentLedger < this.executionBlockOffset) {
         await failTransaction(this.rootEm, txDbId, `Transaction ${txDbId} has no time left to be submitted: currentLedger: ${currentLedger}, executeUntilBlock: ${transaction.executeUntilBlock}, offset ${this.executionBlockOffset}`);
         return TransactionStatus.TX_FAILED;
      } else if (!transaction.executeUntilBlock) {
         console.warn(`Transaction ${txDbId} does not have 'executeUntilBlock' defined`);
         logger.warn(`Transaction ${txDbId} does not have 'executeUntilBlock' defined`);
      }
      const originalTx: xrpl.Payment | xrpl.AccountDelete = JSON.parse(transaction.raw!.toString());
      if (originalTx.TransactionType == "AccountDelete") {
         if (originalTx.Sequence! + DELETE_ACCOUNT_OFFSET > currentLedger) {
            logger.warn(`AccountDelete transaction ${txDbId} does not yet satisfy requirements: sequence ${originalTx.Sequence}, currentLedger ${currentLedger}`);
            console.warn(`AccountDelete transaction ${txDbId} does not yet satisfy requirements: sequence ${originalTx.Sequence}, currentLedger ${currentLedger}`);
            await updateTransactionEntity(this.rootEm, txDbId, async (txEnt: TransactionEntity) => {
               txEnt.reachedStatusPreparedInTimestamp = new Date().getTime();
            })
            return TransactionStatus.TX_PREPARED;
         }
      }
      try {
         const params = {
            tx_blob: txBlob,
         };
         const res = await this.client.post("", {
            method: "submit",
            params: [params],
         });
         const currentBlockHeight = await this.getLatestValidatedLedgerIndex()
         await updateTransactionEntity(this.rootEm, txDbId, async (txEnt) => {
            txEnt.submittedInBlock = currentBlockHeight;
         });
         // https://github.com/flare-foundation/multi-chain-client/blob/4f06fd2bfb7f39e386bc88d0441b6c52e9d8948e/src/base-objects/transactions/XrpTransaction.ts#L345
         if (retry == 0 && res.data.result.engine_result.includes("INSUF_FEE")) {
            await updateTransactionEntity(this.rootEm, txDbId, async (txEnt) => {
               txEnt.status = TransactionStatus.TX_SUBMISSION_FAILED;
            });
            logger.warn(`Transaction ${txDbId} submission failed due to ${res.data.result.engine_result}, ${res.data.result.engine_result_message}`);
            console.warn(`Submission for tx ${txDbId} failed due to ${res.data.result.engine_result}, ${res.data.result.engine_result_message}`);
            return TransactionStatus.TX_SUBMISSION_FAILED;
         } else if (res.data.result.engine_result.startsWith("tes")) {
            await updateTransactionEntity(this.rootEm, txDbId, async (txEnt) => {
               txEnt.status = TransactionStatus.TX_SUBMITTED;
               txEnt.submittedInBlock = res.data.result.validated_ledger_index;
               txEnt.submittedInTimestamp = new Date().getTime();
               txEnt.serverSubmitResponse = Buffer.from(JSON.stringify(res.data.result));
            });
            logger.info(`Transaction ${txDbId} was submitted`);
            console.info(`Transaction ${txDbId} was submitted`);
            return TransactionStatus.TX_SUBMITTED;
         } else {
            await failTransaction(this.rootEm, txDbId, `Transaction ${txDbId} submission failed due to ${res.data.result.engine_result}, ${res.data.result.engine_result_message}`)
            return TransactionStatus.TX_FAILED;
         }
      } catch (e) {
         await updateTransactionEntity(this.rootEm, txDbId, async (txEnt) => {
            txEnt.status = TransactionStatus.TX_PENDING;
            txEnt.reachedStatusPendingInTimestamp = new Date().getTime();
         });
         logger.error(`Transaction ${txDbId} submission failed`, e);
         console.error(`Submission for tx ${txDbId} failed with ${e}`);
         return TransactionStatus.TX_PENDING;
      }
   }

   /**
    * @returns {number} - ledger index of the latest validated ledger
    */
   async getLatestValidatedLedgerIndex(): Promise<number> {
      //https://xrpl.org/transaction-cost.html#server_info
      const serverInfo = (await this.getServerInfo()).result.info;
      /* istanbul ignore next */
      const ledgerIndex = serverInfo.validated_ledger?.seq;
      /* istanbul ignore if */
      if (!ledgerIndex) {
         throw Error("Could not get validated_ledger from server_info");
      }
      return ledgerIndex;
   }

   /**
    *
    * @param {string} privateKey
    * @returns {string} publicKey
    */
   private getPublicKeyFromPrivateKey(privateKey: string, address: string): string {
      /* secp256k1 */
      const secp256k1_privateKey = "00" + privateKey;
      const secp256k1_keypair = {
         privateKey: secp256k1_privateKey,
         publicKey: bytesToHex(secp256k1.keyFromPrivate(secp256k1_privateKey.slice(2)).getPublic().encodeCompressed()),
      };
      if (deriveAddress(secp256k1_keypair.publicKey) === address) return secp256k1_keypair.publicKey;

      /* ed25519 */
      const prefix = "ED";
      const ed25519_privateKey = privateKey.slice(2);
      const ed25519_keypair = {
         privateKey: prefix + ed25519_privateKey,
         publicKey: prefix + bytesToHex(ed25519.keyFromSecret(ed25519_privateKey).getPublic()),
      };
      return ed25519_keypair.publicKey;
   }

   /**
    * @param {string} seed - seed used for wallet creation
    * @param {string|undefined} algorithm
    * @returns {Object} - wallet
    */
   createWalletFromSeed(seed: string, algorithm?: "ed25519" | "ecdsa-secp256k1"): ICreateWalletResponse {
      return xrpl__typeless.Wallet.fromSeed(seed, { algorithm: algorithm });
   }

   /**
    * @param {string} entropy - entropy used for wallet creation
    * @param {string|undefined} algorithm
    * @returns {Object} - wallet
    */
   createWalletFromEntropy(entropy: Uint8Array, algorithm?: "ed25519" | "ecdsa-secp256k1"): ICreateWalletResponse {
      return xrpl__typeless.Wallet.fromEntropy(entropy, { algorithm: algorithm });
   }

   /**
    * @param {string} account
    * @returns {Object} - account info
    */
   async getAccountInfo(account: string): Promise<AccountInfoResponse> {
      const params = {
         account: account,
         signer_lists: true,
         ledger_index: "current",
      } as AccountInfoRequest;
      const res = await this.client.post("", {
         method: "account_info",
         params: [params],
      });
      return res.data;
   }

   /**
    * @returns {Object} - server info
    */
   async getServerInfo(): Promise<xrpl.ServerInfoResponse> {
      const res = await this.client.post("", {
         method: "server_info",
         params: [],
      });
      return res.data;
   }

   /**
    * @param {string} account
    * @returns {number} - account sequence
    */
   async getAccountSequence(account: string): Promise<number> {
      const data = await this.getAccountInfo(account);
      return data.result.account_data.Sequence;
   }

   private roundUpXrpToDrops(amount: number): number {
      return Math.ceil(amount * DROPS_PER_XRP) / DROPS_PER_XRP;
   }
}
