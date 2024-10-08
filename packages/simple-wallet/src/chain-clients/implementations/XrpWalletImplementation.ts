import elliptic from "elliptic";
import xrpl, { convertStringToHex, encodeForSigning, encode as xrplEncode, hashes as xrplHashes } from "xrpl"; // package has some member access issues

const xrpl__typeless = require("xrpl");
import { deriveAddress, sign } from "ripple-keypairs";
import { bytesToHex, prefix0x, stuckTransactionConstants, isValidHexString, checkIfFeeTooHigh, getCurrentTimestampInSeconds, checkIfShouldStillSubmit, roundUpXrpToDrops } from "../../utils/utils";
import { toBN } from "../../utils/bnutils";
import { ChainType, DELETE_ACCOUNT_OFFSET } from "../../utils/constants";
import type { AccountInfoRequest, AccountInfoResponse } from "xrpl";
import type {
   WriteWalletInterface,
   RippleWalletConfig,
   XRPFeeParams,
   SignedObject,
   TransactionInfo,
   IWalletKeys,
} from "../../interfaces/IWalletTransaction";
import BN from "bn.js";
import {
   updateTransactionEntity,
   createInitialTransactionEntity,
   getTransactionInfoById,
   fetchTransactionEntityById,
   failTransaction,
   handleMissingPrivateKey,
   checkIfIsDeleting,
   setAccountIsDeleting,
   handleNoTimeToSubmitLeft} from "../../db/dbutils";

const ed25519 = new elliptic.eddsa("ed25519");
const secp256k1 = new elliptic.ec("secp256k1");

import { logger } from "../../utils/logger";
import { XrpAccountGeneration } from "../account-generation/XrpAccountGeneration";
import { TransactionStatus, TransactionEntity } from "../../entity/transaction";
import { EntityManager } from "@mikro-orm/core";
import { XRPBlockchainAPI } from "../../blockchain-apis/XRPBlockchainAPI";
import { TransactionMonitor } from "../monitoring/TransactionMonitor";

export class XrpWalletImplementation extends XrpAccountGeneration implements WriteWalletInterface {
   chainType: ChainType;
   inTestnet: boolean;
   blockchainAPI: XRPBlockchainAPI;
   blockOffset: number; // number of blocks added to define executeUntilBlock (only if not provided in original data)
   feeIncrease: number;
   executionBlockOffset: number; //buffer before submitting -> will submit only if (currentLedger - executeUntilBlock) >= executionBlockOffset
   rootEm!: EntityManager;
   walletKeys!: IWalletKeys;

   private monitor: TransactionMonitor;

   constructor(createConfig: RippleWalletConfig) {
      super(createConfig.inTestnet ?? false);
      this.inTestnet = createConfig.inTestnet ?? false;

      this.chainType = this.inTestnet ? ChainType.testXRP : ChainType.XRP;
      this.blockchainAPI = new XRPBlockchainAPI(this.chainType, createConfig);
      const resubmit = stuckTransactionConstants(this.chainType);

      this.blockOffset = createConfig.stuckTransactionOptions?.blockOffset ?? resubmit.blockOffset!;

      this.feeIncrease = createConfig.stuckTransactionOptions?.feeIncrease ?? resubmit.feeIncrease!;
      this.executionBlockOffset = createConfig.stuckTransactionOptions?.executionBlockOffset ?? resubmit.executionBlockOffset!;
      this.rootEm = createConfig.em;
      this.walletKeys = createConfig.walletKeys;

      this.monitor = new TransactionMonitor(this.chainType, this.rootEm);
   }

   /**
    * @param {string} account
    * @returns {BN} - balance in drops
    */
   async getAccountBalance(account: string): Promise<BN> {
      try {
         const data = await this.getAccountInfo(account);
         logger.info(`Get account balance for ${account}`, data.result.account_data?.Balance || 0);
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
      return toBN(xrpl__typeless.xrpToDrops(roundUpXrpToDrops(baseFee)));
   }

   /**
    * @param {string} source
    * @param {string} destination
    * @param {BN|null} amountInDrops - if null => AccountDelete transaction will be created
    * @param {BN|undefined} feeInDrops - automatically set if undefined
    * @param {string|undefined} note
    * @param {BN|undefined} maxFeeInDrops
    * @returns {Object} - containing transaction id tx_id and optional result
    */
   async createPaymentTransaction(
      source: string,
      destination: string,
      amountInDrops: BN | null,
      feeInDrops?: BN,
      note?: string,
      maxFeeInDrops?: BN,
      executeUntilBlock?: number,
      executeUntilTimestamp?: BN
   ): Promise<number> {
      logger.info(`Received request to create tx from ${source} to ${destination} with amount ${amountInDrops?.toString()} and reference ${note}`);
      if (await checkIfIsDeleting(this.rootEm, source)) {
         logger.error(`Cannot receive requests. ${source} is deleting`);
         throw new Error(`Cannot receive requests. ${source} is deleting`);
      }
      const privateKey = await this.walletKeys.getKey(source);
      if (!privateKey) {
          logger.error(`Cannot prepare transaction ${source}. Missing private key.`)
          throw new Error(`Cannot prepare transaction ${source}. Missing private key.`);
      }
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
      destination: string,
      feeInDrops?: BN,
      note?: string,
      maxFeeInDrops?: BN,
      executeUntilBlock?: number,
      executeUntilTimestamp?: BN
   ): Promise<number> {
      logger.info(`Received request to delete account from ${source} to ${destination} with reference ${note}`);
      if (await checkIfIsDeleting(this.rootEm, source)) {
         logger.error(`Cannot receive requests. ${source} is deleting`);
         throw new Error(`Cannot receive requests. ${source} is deleting`);
      }
      const privateKey = await this.walletKeys.getKey(source);
      if (!privateKey) {
         logger.error(`Cannot prepare transaction ${source}. Missing private key.`)
         throw new Error(`Cannot prepare transaction ${source}. Missing private key.`);
      }
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

   async startMonitoringTransactionProgress(): Promise<void> {
      await this.monitor.startMonitoringTransactionProgress(
          this.submitPreparedTransactions.bind(this),
          this.resubmitPendingTransaction.bind(this),
          this.prepareAndSubmitCreatedTransaction.bind(this),
          this.checkSubmittedTransaction.bind(this),
          async () => this.checkXrpNetworkStatus(),
          this.resubmitSubmissionFailedTransactions.bind(this)
      );
   }

   async isMonitoring(): Promise<boolean> {
      return await this.monitor.isMonitoring();
   }

   async stopMonitoring(): Promise<void> {
      await this.monitor.stopMonitoring();
   }

   async checkXrpNetworkStatus(): Promise<boolean> {
      try {
         await this.getServerInfo();
         return true;
      } catch (error) {
         logger.error("Cannot ger response from server", error);
         return false;
      }
   }

   ///////////////////////////////////////////////////////////////////////////////////////
   // HELPER AND CLIENT SPECIFIC FUNCTIONS ////////////////////////////////////////////////
   ///////////////////////////////////////////////////////////////////////////////////////

   async resubmitSubmissionFailedTransactions(txEnt: TransactionEntity): Promise<void> {
      logger.info(`Resubmitting submission failed transaction ${txEnt.id}.`);
      const transaction = JSON.parse(txEnt.raw!) as xrpl.Payment | xrpl.AccountDelete;
      const privateKey = await this.walletKeys.getKey(txEnt.source);
      if (!privateKey) {
         await handleMissingPrivateKey(this.rootEm, txEnt.id, "resubmitSubmissionFailedTransactions");
         return;
      }
      const newFee = toBN(transaction.Fee!).muln(this.feeIncrease);
      await this.resubmitTransaction(txEnt.id, privateKey, transaction, newFee);
   }

   async resubmitPendingTransaction(txEnt: TransactionEntity): Promise<void> {
      logger.info(`Pending transaction ${txEnt.id} is being resubmitted.`);
      const transaction = JSON.parse(txEnt.raw!) as xrpl.Payment | xrpl.AccountDelete;
      const privateKey = await this.walletKeys.getKey(txEnt.source);
      if (!privateKey) {
         await handleMissingPrivateKey(this.rootEm, txEnt.id, "resubmitPendingTransaction");
         return;
      }

      if (!await this.checkIfTransactionAppears(txEnt.id)) {
         const newFee = toBN(transaction.Fee!);
         await this.resubmitTransaction(txEnt.id, privateKey, transaction, newFee);
      }
   }

   async submitPreparedTransactions(txEnt: TransactionEntity): Promise<void> {
      logger.info(`Prepared transaction ${txEnt.id} is being submitted.`);
      const transaction = JSON.parse(txEnt.raw!) as xrpl.Payment | xrpl.AccountDelete;
      const privateKey = await this.walletKeys.getKey(txEnt.source);
      if (!privateKey) {
         await handleMissingPrivateKey(this.rootEm, txEnt.id, "submitPreparedTransactions");
         return;
      }
      await this.signAndSubmitProcess(txEnt.id, privateKey, transaction);
   }

   async prepareAndSubmitCreatedTransaction(txEnt: TransactionEntity): Promise<void> {
      const currentLedger = await this.getLatestValidatedLedgerIndex();
      const currentTimestamp = toBN(getCurrentTimestampInSeconds());
      const shouldSubmit = checkIfShouldStillSubmit(this, currentLedger, txEnt.executeUntilBlock, txEnt.executeUntilTimestamp);
      if (!shouldSubmit) {
         await handleNoTimeToSubmitLeft(this.rootEm, txEnt.id, currentLedger, this.executionBlockOffset, "prepareAndSubmitCreatedTransaction", txEnt.executeUntilBlock, txEnt.executeUntilTimestamp?.toString());
         return;
      } else if (!txEnt.executeUntilBlock && !txEnt.executeUntilTimestamp) {
         await updateTransactionEntity(this.rootEm, txEnt.id, (txEntToUpdate) => {
            txEntToUpdate.executeUntilBlock = currentLedger + this.blockOffset;
         });
      }
     logger.info(`Preparing transaction ${txEnt.id}`);
      //prepare
      const transaction = await this.preparePaymentTransaction(
         txEnt.source,
         txEnt.destination,
         txEnt.amount ?? null,
         txEnt.fee,
         txEnt.reference,
         txEnt.executeUntilBlock
      );
      const privateKey = await this.walletKeys.getKey(txEnt.source);
      if (!privateKey) {
         await handleMissingPrivateKey(this.rootEm, txEnt.id, "prepareAndSubmitCreatedTransaction");
         return;
      }
      if (checkIfFeeTooHigh(toBN(transaction.Fee!), txEnt.maxFee ?? null)) {
         await failTransaction(this.rootEm, txEnt.id, `Fee restriction (fee: ${transaction.Fee}, maxFee: ${txEnt.maxFee?.toString()})`);
      } else {
         // save tx in db
         await updateTransactionEntity(this.rootEm, txEnt.id, (txEntToUpdate) => {
            txEntToUpdate.raw = JSON.stringify(transaction);
            txEntToUpdate.executeUntilBlock = transaction.LastLedgerSequence;
            txEntToUpdate.status = TransactionStatus.TX_PREPARED;
            txEntToUpdate.reachedStatusPreparedInTimestamp = currentTimestamp;
         });
         logger.info(`Transaction ${txEnt.id} prepared.`);
         await this.signAndSubmitProcess(txEnt.id, privateKey, transaction);
      }
   }

   async checkSubmittedTransaction(txEnt: TransactionEntity): Promise<void> {
      logger.info(`Submitted transaction ${txEnt.id} (${txEnt.transactionHash}) is being checked.`);
      const txResp = await this.blockchainAPI.getTransaction(txEnt.transactionHash!);
      const currentTimestamp = toBN(getCurrentTimestampInSeconds());
      if (txResp.data.result.validated) {
         await updateTransactionEntity(this.rootEm, txEnt.id, (txEntToUpdate) => {
            txEntToUpdate.status = TransactionStatus.TX_SUCCESS;
            txEntToUpdate.reachedFinalStatusInTimestamp = toBN(currentTimestamp);
         });
         logger.info(`Transaction ${txEnt.id} was accepted`);
      } else {
         const currentLedger = await this.getLatestValidatedLedgerIndex();
         const shouldSubmit = checkIfShouldStillSubmit(this, currentLedger, txEnt.executeUntilBlock, txEnt.executeUntilTimestamp);
         if (!shouldSubmit) {
            await handleNoTimeToSubmitLeft(this.rootEm, txEnt.id, currentLedger, this.executionBlockOffset, "checkSubmittedTransaction", txEnt.executeUntilBlock, txEnt.executeUntilTimestamp?.toString());
            return;
         }
      }
   }

   async signAndSubmitProcess(txId: number, privateKey: string, transaction: xrpl.Payment | xrpl.AccountDelete): Promise<void> {
      logger.info(`Submitting transaction ${txId}.`);
      const signed = this.signTransaction(transaction, privateKey);
      logger.info(`Transaction ${txId} is signed.`);
      // save tx in db
      await updateTransactionEntity(this.rootEm, txId, (txEnt) => {
         txEnt.transactionHash = signed.txHash;
      });
      const txStatus = await this.submitTransaction(signed.txBlob, txId);
      // resubmit with higher fee
      if (txStatus == TransactionStatus.TX_SUBMISSION_FAILED) {
         const newFee = toBN(transaction.Fee!).muln(this.feeIncrease);
         await this.resubmitTransaction(txId, privateKey, transaction, newFee);
      }
      if (txStatus == TransactionStatus.TX_PENDING) {
         await updateTransactionEntity(this.rootEm, txId, (txEnt) => {
            txEnt.reachedStatusPendingInTimestamp = toBN(getCurrentTimestampInSeconds());
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
      const txEnt = await fetchTransactionEntityById(this.rootEm, txId);
      const waitUntilBlock = txEnt.submittedInBlock + this.blockOffset;

      let txResp = await this.blockchainAPI.getTransaction(txEnt.transactionHash!);
      while (!(txResp.data.result.validated) && (await this.getLatestValidatedLedgerIndex()) <= waitUntilBlock) {
         txResp = await this.blockchainAPI.getTransaction(txEnt.transactionHash!);
      }
      if (txResp.data.result.validated) {
         await updateTransactionEntity(this.rootEm, txId, (txEnt) => {
            txEnt.status = TransactionStatus.TX_SUCCESS;
            txEnt.reachedFinalStatusInTimestamp = toBN(getCurrentTimestampInSeconds());
         });
         logger.info(`Transaction ${txId} was accepted`);
         return true;
      }
      return false;
   }

   async resubmitTransaction(txId: number, privateKey: string, transaction: xrpl.Payment | xrpl.AccountDelete, newFee: BN) {
      logger.info(`Transaction ${txId} is being resubmitted.`);
      const origTx = await fetchTransactionEntityById(this.rootEm, txId);
      if (checkIfFeeTooHigh(newFee, origTx.maxFee ?? null)) {
         await failTransaction(this.rootEm, txId, `Cannot resubmit transaction ${txId}. Due to fee restriction (fee: ${newFee.toString()}, maxFee: ${origTx.maxFee?.toString()})`);
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
            originalTx.amount ?? null,
            newFee,
            originalTx.reference,
            originalTx.maxFee,
            originalTx.executeUntilBlock,
            originalTx.executeUntilTimestamp
         );
         await updateTransactionEntity(this.rootEm, txId, (txEnt) => {
            txEnt.status = TransactionStatus.TX_REPLACED;
            txEnt.replaced_by = resubmittedTx;
            txEnt.reachedFinalStatusInTimestamp = toBN(getCurrentTimestampInSeconds());
         });
         logger.info(`Transaction ${txId} was replaced by ${resubmittedTx.id}.`);

         const signed = this.signTransaction(newTransaction, privateKey);
         logger.info(`Transaction ${resubmittedTx.id} is signed.`);
         const currentBlockHeight = await this.getLatestValidatedLedgerIndex();
         // save tx in db
         await updateTransactionEntity(this.rootEm, resubmittedTx.id, (txEnt) => {
            txEnt.raw = JSON.stringify(transaction);
            txEnt.transactionHash = signed.txHash;
            txEnt.submittedInBlock = currentBlockHeight;
            txEnt.executeUntilBlock = transaction.LastLedgerSequence;
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
         const currentFee = await this.getCurrentTransactionFee({ isPayment });
         tr.Fee = currentFee.toString();
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
   signTransaction(transaction: xrpl.Transaction, privateKey: string): SignedObject {
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
   async submitTransaction(txBlob: string, txDbId: number, retry = 0): Promise<TransactionStatus> {
      logger.info(`Transaction ${txDbId} is being submitted.`);
      // check if there is still time to submit
      const transaction = await fetchTransactionEntityById(this.rootEm, txDbId);
      const currentLedger = await this.getLatestValidatedLedgerIndex();
      const shouldSubmit = checkIfShouldStillSubmit(this, currentLedger, transaction.executeUntilBlock, transaction.executeUntilTimestamp);
      if (!shouldSubmit) {
         await handleNoTimeToSubmitLeft(this.rootEm, txDbId, currentLedger, this.executionBlockOffset, "submitTransaction", transaction.executeUntilBlock, transaction.executeUntilTimestamp?.toString());
          return TransactionStatus.TX_FAILED;
      }

      const currentTimestamp = toBN(getCurrentTimestampInSeconds());
      const originalTx = JSON.parse(transaction.raw!) as xrpl.Payment | xrpl.AccountDelete;
      if (originalTx.TransactionType == "AccountDelete") {
         if (originalTx.Sequence! + DELETE_ACCOUNT_OFFSET > currentLedger) {
            logger.warn(`AccountDelete transaction ${txDbId} does not yet satisfy requirements: sequence ${originalTx.Sequence}, currentLedger ${currentLedger}`);
            await updateTransactionEntity(this.rootEm, txDbId, (txEnt: TransactionEntity) => {
               txEnt.reachedStatusPreparedInTimestamp = currentTimestamp;
            })
            return TransactionStatus.TX_PREPARED;
         }
      }
      try {
         const res = await this.blockchainAPI.submitTransaction({
            tx_blob: txBlob,
         });
         const currentBlockHeight = await this.getLatestValidatedLedgerIndex()
         await updateTransactionEntity(this.rootEm, txDbId, (txEnt) => {
            txEnt.submittedInBlock = currentBlockHeight;
         });
         // https://github.com/flare-foundation/multi-chain-client/blob/4f06fd2bfb7f39e386bc88d0441b6c52e9d8948e/src/base-objects/transactions/XrpTransaction.ts#L345
         if (retry == 0 && res.data.result.engine_result.includes("INSUF_FEE")) {
            await updateTransactionEntity(this.rootEm, txDbId, (txEnt) => {
               txEnt.status = TransactionStatus.TX_SUBMISSION_FAILED;
            });
            logger.warn(`Transaction ${txDbId} submission failed due to ${res.data.result.engine_result}, ${res.data.result.engine_result_message}`);
            return TransactionStatus.TX_SUBMISSION_FAILED;
         } else if (res.data.result.engine_result.startsWith("tes")) {
            await updateTransactionEntity(this.rootEm, txDbId, (txEnt) => {
               txEnt.status = TransactionStatus.TX_SUBMITTED;
               txEnt.submittedInBlock = res.data.result.validated_ledger_index;
               txEnt.serverSubmitResponse = JSON.stringify(res.data.result);
            });
            logger.info(`Transaction ${txDbId} was submitted`);
            return TransactionStatus.TX_SUBMITTED;
         } else {
            await failTransaction(this.rootEm, txDbId, `Transaction ${txDbId} submission failed due to ${res.data.result.engine_result}, ${res.data.result.engine_result_message}`)
            return TransactionStatus.TX_FAILED;
         }
      } catch (e) {
         await updateTransactionEntity(this.rootEm, txDbId, (txEnt) => {
            txEnt.status = TransactionStatus.TX_PENDING;
            txEnt.reachedStatusPendingInTimestamp = currentTimestamp;
         });
         logger.error(`Transaction ${txDbId} submission failed`, e);
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
    * @param {string} account
    * @returns {Object} - account info
    */
   async getAccountInfo(account: string): Promise<AccountInfoResponse> {
      const params = {
         account: account,
         signer_lists: true,
         ledger_index: "current",
      } as AccountInfoRequest;
      const res = await this.blockchainAPI.getAccountInfo(params);
      return res.data;
   }

   /**
    * @returns {Object} - server info
    */
   async getServerInfo(): Promise<xrpl.ServerInfoResponse> {
      const res = await this.blockchainAPI.getServerInfo();
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
}
