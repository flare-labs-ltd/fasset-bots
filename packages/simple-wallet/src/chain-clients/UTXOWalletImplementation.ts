import axios, { AxiosInstance, AxiosRequestConfig } from "axios";
import axiosRateLimit from "../axios-rate-limiter/axios-rate-limit";
import * as bitcore from "bitcore-lib";
import * as dogecore from "bitcore-lib-doge";
import { excludeNullFields, sleepMs, stuckTransactionConstants, unPrefix0x } from "../utils/utils";
import { toBN, toNumber } from "../utils/bnutils";
import {
   BTC_DUST_AMOUNT,
   BTC_FEE_PER_KB,
   ChainType,
   DEFAULT_RATE_LIMIT_OPTIONS,
   DOGE_DUST_AMOUNT,
   DOGE_FEE_PER_KB,
   UTXO_INPUT_SIZE,
   UTXO_OUTPUT_SIZE,
   UTXO_OVERHEAD_SIZE,
} from "../utils/constants";
import type { BaseWalletConfig, SignedObject, TransactionInfo, UTXOFeeParams } from "../interfaces/WalletTransactionInterface";
import type { ISubmitTransactionResponse, UTXO, WriteWalletInterface } from "../interfaces/WalletTransactionInterface";
// eslint-disable-next-line @typescript-eslint/no-var-requires
const UnspentOutput = require("bitcore-lib/lib/transaction/unspentoutput");
// eslint-disable-next-line @typescript-eslint/no-var-requires
import BN from "bn.js";
import { ORM } from "../orm/mikro-orm.config";
import {
   checkIfIsDeleting,
   createInitialTransactionEntity,
   failTransaction,
   fetchTransactionEntityById,
   fetchUTXOsByTxHash,
   fetchUnspentUTXOs,
   getTransactionInfoById,
   handleMissingPrivateKey,
   processTransactions,
   setAccountIsDeleting,
   storeUTXOS,
   updateTransactionEntity,
   updateUTXOEntity,
} from "../db/dbutils";
import { IWalletKeys } from "../db/wallet";
import { logger } from "../utils/logger";
import { UTXOAccountGeneration } from "./account-generation/UTXOAccountGeneration";
import { TransactionStatus, TransactionEntity } from "../entity/transaction";
import { SpentHeightEnum, UTXOEntity } from "../entity/utxo";
export abstract class UTXOWalletImplementation extends UTXOAccountGeneration implements WriteWalletInterface {
   inTestnet: boolean;
   client: AxiosInstance;
   orm!: ORM;
   walletKeys!: IWalletKeys;
   blockOffset: number;
   feeIncrease: number;
   executionBlockOffset: number;

   monitoring: boolean = false;
   enoughConfirmations: number = 2;
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
         validateStatus: function (status: number) {
            /* istanbul ignore next */
            return (status >= 200 && status < 300) || status == 500;
         },
      };
      // don't need rpc auth as we are always sending signed transactions
      const client = axios.create(createAxiosConfig);
      this.client = axiosRateLimit(client, {
         ...DEFAULT_RATE_LIMIT_OPTIONS,
         ...createConfig.rateLimitOptions,
      });
      const resubmit = stuckTransactionConstants(this.chainType);
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      this.blockOffset = createConfig.stuckTransactionOptions?.blockOffset ?? resubmit.blockOffset!;
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      this.feeIncrease = createConfig.stuckTransactionOptions?.feeIncrease ?? resubmit.feeIncrease!;
      this.executionBlockOffset = createConfig.stuckTransactionOptions?.executionBlockOffset ?? resubmit.executionBlockOffset!;
   }

   /**
    * @param {string} account
    * @returns {BN} - confirmed balance in satoshis
    */
   async getAccountBalance(account: string): Promise<BN> {
      try {
         const res = await this.client.get(`/address/${account}/balance`);
         return toBN(res.data.balance);
      } catch (error) {
         logger.error(`Cannot get account balance for ${account}`, error);
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
      executeUntilTimestamp?: number
   ): Promise<number> {
      logger.info(`Received request to create tx from ${source} to ${destination} with amount ${amountInSatoshi} and reference ${note}`);
      if (await checkIfIsDeleting(this.orm, source)) {
         logger.error(`Cannot receive requests. ${source} is deleting`);
         console.error(`Cannot receive requests. ${source} is deleting`);
         throw new Error(`Cannot receive requests. ${source} is deleting`);
      }
      await this.walletKeys.addKey(source, privateKey);
      const ent = await createInitialTransactionEntity(
         this.orm,
         this.chainType,
         source,
         destination,
         amountInSatoshi,
         feeInSatoshi,
         note,
         maxFeeInSatoshi,
         undefined,
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
    * @param {BN|undefined} feeInSatoshi - automatically set if undefined
    * @param {string|undefined} note
    * @param {BN|undefined} maxFeeInSatoshi
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
      executeUntilTimestamp?: number
   ): Promise<number> {
      logger.info(`Received request to delete account from ${source} to ${destination} with reference ${note}`);
      if (await checkIfIsDeleting(this.orm, source)) {
         logger.error(`Cannot receive requests. ${source} is deleting`);
         throw new Error(`Cannot receive requests. ${source} is deleting`);
      }
      await this.walletKeys.addKey(source, privateKey);
      await this.walletKeys.addKey(source, privateKey);
      await setAccountIsDeleting(this.orm, source);
      const ent = await createInitialTransactionEntity(
         this.orm,
         this.chainType,
         source,
         destination,
         null,
         feeInSatoshi,
         note,
         maxFeeInSatoshi,
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
      return await getTransactionInfoById(this.orm, dbId);
   }

   ///////////////////////////////////////////////////////////////////////////////////////
   // MONITORING /////////////////////////////////////////////////////////////////////////
   ///////////////////////////////////////////////////////////////////////////////////////
   stopMonitoring() {
      this.monitoring = false;
   }

   /**
    * Background processing
    */
   async startMonitoringTransactionProgress(): Promise<void> {
      this.monitoring = true;
      while (this.monitoring) {
         const networkUp = await this.checkUTXONetworkStatus();
         if (!networkUp) {
            logger.error(`Trying again in ${this.restartInDueNoResponse}`);
            await sleepMs(this.restartInDueNoResponse);
            continue;
         }
         try {
            await processTransactions(this.orm, this.chainType, TransactionStatus.TX_PREPARED, this.submitPreparedTransactions.bind(this));
            await processTransactions(this.orm, this.chainType, TransactionStatus.TX_PENDING, this.checkPendingTransaction.bind(this));
            await processTransactions(this.orm, this.chainType, TransactionStatus.TX_CREATED, this.prepareAndSubmitCreatedTransaction.bind(this));
            await processTransactions(this.orm, this.chainType, TransactionStatus.TX_SUBMITTED, this.checkSubmittedTransaction.bind(this));
         } catch (error) {
            logger.error(`Monitoring run into error. Restarting in ${this.restartInDueToError}`, error);
         }
         await sleepMs(this.restartInDueToError);
      }
   }

   async checkUTXONetworkStatus(): Promise<boolean> {
      //TODO - maybe can be more robust if also take into account response
      try {
         await this.getCurrentBlockHeight();
         return true;
      } catch (error) {
         logger.error("Cannot ger response from server", error);
         return false;
      }
   }

   ///////////////////////////////////////////////////////////////////////////////////////
   // HELPER OR CLIENT SPECIFIC FUNCTIONS ////////////////////////////////////////////////
   ///////////////////////////////////////////////////////////////////////////////////////
   async prepareAndSubmitCreatedTransaction(txEnt: TransactionEntity): Promise<void> {
      const currentBlock = await this.getCurrentBlockHeight();
      if (txEnt.executeUntilBlock && currentBlock >= txEnt.executeUntilBlock) {
         await failTransaction(this.orm, txEnt.id, `Current ledger ${currentBlock} >= last transaction ledger ${txEnt.executeUntilBlock}`);
         return;
      } else if (!txEnt.executeUntilBlock) {
         await updateTransactionEntity(this.orm, txEnt.id, async (txEnt) => {
            txEnt.executeUntilBlock = currentBlock + this.blockOffset;
         });
      }
      const transaction = await this.preparePaymentTransaction(txEnt.source, txEnt.destination, txEnt.amount || null, txEnt.fee, txEnt.reference, txEnt.executeUntilBlock);
      const privateKey = await this.walletKeys.getKey(txEnt.source);
      if (!privateKey) {
         await handleMissingPrivateKey(this.orm, txEnt.id);
         return;
      }
      if (this.checkIfFeeTooHigh(toBN(transaction.getFee()), txEnt.maxFee || null)) {
         await failTransaction(this.orm, txEnt.id, `Fee restriction (fee: ${transaction.getFee()}, maxFee: ${txEnt.maxFee?.toString()})`);
      } else {
         // save tx in db
         await updateTransactionEntity(this.orm, txEnt.id, async (txEntToUpdate) => {
            txEntToUpdate.raw = Buffer.from(JSON.stringify(transaction));
            txEntToUpdate.status = TransactionStatus.TX_PREPARED;
         });
         await this.signAndSubmitProcess(txEnt.id, privateKey, transaction);
      }
   }

   async checkSubmittedTransaction(txEnt: TransactionEntity): Promise<void> {
      try {
         const txResp = await this.client.get(`/tx/${txEnt.transactionHash}`);
         // success
         if (txResp.data.blockHash && txResp.data.confirmations >= this.enoughConfirmations) {
            await updateTransactionEntity(this.orm, txEnt.id, async (txEntToUpdate) => {
               txEntToUpdate.confirmations = txResp.data.confirmations;
               txEntToUpdate.status = TransactionStatus.TX_SUCCESS;
            });
            const utxos = await fetchUTXOsByTxHash(this.orm, txEnt.transactionHash!); //TODO
            for (const utxo of utxos) {
               await updateUTXOEntity(this.orm, utxo.mintTransactionHash, utxo.position, async (utxoEnt) => {
                  utxoEnt.spentHeight = SpentHeightEnum.SPENT;
               });
            }
            logger.info(`Transaction ${txEnt.id} was accepted`);
            console.info(`Transaction ${txEnt.id} was accepted`);
            return;
         }
      } catch (e) {
         console.error(`Transaction ${txEnt.transactionHash} cannot be fetched from node`);
         logger.error(`Transaction ${txEnt.transactionHash} cannot be fetched from node`, e);
      }
      //TODO handle stuck transactions -> if not accepted in next two block?: could do rbf, but than all dependant will change too!
      const currentBlockHeight = await this.getCurrentBlockHeight();
      if (currentBlockHeight - txEnt.submittedInBlock > this.enoughConfirmations) {
         console.error(`Transaction ${txEnt.transactionHash} is probably not going to be accepted!`);
         await failTransaction(this.orm, txEnt.id, `Not accepted after ${this.enoughConfirmations} blocks`);
      }
   }

   async submitPreparedTransactions(txEnt: TransactionEntity): Promise<void> {
      const transaction = JSON.parse(txEnt.raw!.toString());
      const privateKey = await this.walletKeys.getKey(txEnt.source);
      if (!privateKey) {
         await handleMissingPrivateKey(this.orm, txEnt.id);
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
         await updateTransactionEntity(this.orm, txId, async (txEnt) => {
            txEnt.transactionHash = signed.txHash;
         });
      } catch (e: any) {
         await failTransaction(this.orm, txId, `Cannot sign transaction ${txId}`, e);
         return;
      }
      // submit
      const txStatus = await this.submitTransaction(signed.txBlob, txId);
      const txEnt = await fetchTransactionEntityById(this.orm, txId);
      if (txStatus == TransactionStatus.TX_PENDING) {
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
      executeUntilBlock?: number
   ): Promise<bitcore.Transaction> {
      const isPayment = amountInSatoshi != null;
      const core = this.getCore();
      const utxos = await this.fetchUTXOs(source, amountInSatoshi, this.getEstimatedNumberOfOutputs(amountInSatoshi, note));
      if (amountInSatoshi == null) {
         const estimateFee = this.getEstimateFee(utxos.length);
         amountInSatoshi = (await this.getAccountBalance(source)).sub(estimateFee);
      }
      if (amountInSatoshi.lte(this.getDustAmount())) {
         throw new Error(
            `Will not prepare transaction for ${source}. Amount ${amountInSatoshi.toString()} is less than dust ${this.getDustAmount().toString()}`
         );
      }
      const tr = new core.Transaction().from(utxos.map((utxo) => new UnspentOutput(utxo))).to(destination, toNumber(amountInSatoshi));
      if (isPayment) {
         tr.change(source);
      }
      if (feeInSatoshi) {
         tr.fee(toNumber(feeInSatoshi));
      }
      if (note) {
         tr.addData(Buffer.from(unPrefix0x(note), "hex"));
      }
      tr.enableRBF();
      if (isPayment && !feeInSatoshi) {//TODO
         const currentFee = tr.getFee();
         tr.fee(currentFee * this.feeIncrease);
      }
      return tr;
   }

   /**
    * @param {Object} transaction
    * @param {string} privateKey
    * @returns {string} - hex string
    */
   private async signTransaction(transaction: bitcore.Transaction, privateKey: string): Promise<SignedObject> {
      const signedAndSerialized = transaction.sign(privateKey).serialize();
      const txId = transaction.id;
      return { txBlob: signedAndSerialized, txHash: txId };
   }

   /**
    * @param {string} signedTx
    */
   private async submitTransaction(signedTx: string, txId: number): Promise<TransactionStatus> {
      // check if there is still time to submit
      const transaction = await fetchTransactionEntityById(this.orm, txId);
      const currentBlockHeight = await this.getCurrentBlockHeight();
      if (transaction.executeUntilBlock && transaction.executeUntilBlock - currentBlockHeight < this.executionBlockOffset) {
         await failTransaction(this.orm, txId, `Transaction ${txId} has no time left to be submitted: currentBlockHeight: ${currentBlockHeight}, executeUntilBlock: ${transaction.executeUntilBlock}, offset ${this.executionBlockOffset}`);
         return TransactionStatus.TX_FAILED;
      } else if (!transaction.executeUntilBlock) {
         console.warn(`Transaction ${txId} does not have 'executeUntilBlock' defined`);
         logger.warn(`Transaction ${txId} does not have 'executeUntilBlock' defined`);
      }
      try {
         const resp = await this.client.post(`/tx/send`, { rawTx: signedTx });
         if (resp.status == 200) {
            const submittedBlockHeight = await this.getCurrentBlockHeight();
            await updateTransactionEntity(this.orm, txId, async (txEnt) => {
               txEnt.status = TransactionStatus.TX_PENDING;
               txEnt.submittedInBlock = submittedBlockHeight;
               txEnt.submittedInTimestamp = new Date().getTime();
               ;
            });
            const txEnt = await fetchTransactionEntityById(this.orm, txId);
            const transaction = JSON.parse(txEnt.raw!.toString());
            for (const input of transaction.inputs) {
               await updateUTXOEntity(this.orm, input.prevTxId.toString("hex"), input.outputIndex, async (utxoEnt) => {
                  utxoEnt.spentHeight = SpentHeightEnum.SENT;
               });
            }
            return TransactionStatus.TX_PENDING;
         } else {
            await failTransaction(this.orm, txId, `Transaction ${txId} submission failed ${resp.status}`, resp.data);
            return TransactionStatus.TX_FAILED;
         }
      } catch (e: any) {
         //TODO in case of network problems
         await failTransaction(this.orm, txId, `Transaction ${txId} submission failed`, e);
         return TransactionStatus.TX_FAILED;
      }
   }
   /**
    * Retrieves unspent transactions in format accepted by transaction
    * @param {string} address
    * @param {BN|null} amountInSatoshi - if null => empty all funds
    * @param {number} estimatedNumOfOutputs
    * @returns {Object[]}
    */
   async fetchUTXOs(address: string, amountInSatoshi: BN | null, estimatedNumOfOutputs: number): Promise<UTXO[]> {
      const utxos = await this.listUnspent(address, amountInSatoshi, estimatedNumOfOutputs);
      const allUTXOs: UTXO[] = [];
      for (const utxo of utxos) {
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

   /**
    * Retrieves unspent transactions
    * @param {string} address
    * @param {BN|null} amountInSatoshi - if null => empty all funds
    * @param {number} estimatedNumOfOutputs
    * @returns {Object[]}
    */
   private async listUnspent(address: string, amountInSatoshi: BN | null, estimatedNumOfOutputs: number): Promise<any[]> {
      // fetch db utxos
      let dbUTXOS = await fetchUnspentUTXOs(this.orm, address);
      // fill from mempool and refetch
      if (dbUTXOS.length == 0) {
         await this.fillUTXOsFromMempool(address);
         dbUTXOS = await fetchUnspentUTXOs(this.orm, address);
      }
      if (amountInSatoshi == null) {
         return dbUTXOS;
      }

      const needed = await this.returnNeededUTXOs(dbUTXOS, estimatedNumOfOutputs, amountInSatoshi);
      if (needed) {
         return needed;
      }
      // not enough funds in db
      await this.fillUTXOsFromMempool(address);
      dbUTXOS = await fetchUnspentUTXOs(this.orm, address);
      const neededAfter = await this.returnNeededUTXOs(dbUTXOS, estimatedNumOfOutputs, amountInSatoshi);
      if (neededAfter) {
         return neededAfter;
      }
      return dbUTXOS;
   }

   private async returnNeededUTXOs(allUTXOS: UTXOEntity[], estimatedNumOfOutputs: number, amountInSatoshi: BN): Promise<UTXOEntity[] | null> {
      const neededUTXOs = [];
      let sum = 0;
      for (const utxo of allUTXOS) {
         neededUTXOs.push(utxo);
         const value = Number(utxo.value);
         sum += value;
         const est_fee = this.getEstimateFee(neededUTXOs.length, estimatedNumOfOutputs);
         // multiply estimated fee by 2 to ensure enough funds TODO: is it enough?
         if (toBN(sum).gt(amountInSatoshi.add(est_fee.muln(2)))) {
            return neededUTXOs;
         }
      }
      return null;
   }

   private async fillUTXOsFromMempool(address: string) {
      const res = await this.client.get(`/address/${address}?unspent=true&excludeconflicting=true`);
      // https://github.com/bitpay/bitcore/blob/405f8b17dbb537277bea89ca131214793e577151/packages/bitcore-node/src/types/Coin.ts#L26
      // utxo.mintHeight > -3 => excludeConflicting; utxo.spentHeight == -2 -> unspent
      const mempoolUTXOs = (res.data as any[]).filter((utxo) => utxo.mintHeight > -3 && utxo.spentHeight == -2).sort((a, b) => a.value - b.value);
      await storeUTXOS(this.orm, address, mempoolUTXOs);
   }

   async getCurrentBlockHeight(): Promise<number> {
      const res = await this.client.get(`/block/tip`);
      return res.data.height;
   }

   private async waitForTransactionToAppearInMempool(txId: number, retry: number = 0): Promise<void> {
      const txEnt = await fetchTransactionEntityById(this.orm, txId);
      const start = txEnt.submittedInTimestamp;
      while (new Date().getTime() - start < this.mempoolWaitingTime) {
         try {
            const txResp = await this.client.get(`/tx/${txEnt.transactionHash}`);
            if (txResp) {
               await updateTransactionEntity(this.orm, txId, async (txEnt) => {
                  txEnt.status = TransactionStatus.TX_SUBMITTED;
               });
               return;
            }
         } catch (e) {
            if (axios.isAxiosError(e)) {
               const responseData = e.response?.data;
               logger.warn(`Transaction ${txId} not yet seen in mempool`, responseData)
               console.warn(`Transaction ${txId} not yet seen in mempool`, responseData)
            } else {
               logger.warn(`Transaction ${txId} not yet seen in mempool`, e)
               console.warn(`Transaction ${txId} not yet seen in mempool`, e)
            }
            await sleepMs(1000);
         }
      }
      // transaction was not accepted in mempool by one minute => replace by fee one time
      if (retry > 0) {
         await failTransaction(this.orm, txId, `Transaction ${txId} was not accepted in mempool`);
      } else {
         if (!(await this.checkIfShouldStillSubmit(txEnt.executeUntilBlock || null))) {
            const currentBlock = await this.getCurrentBlockHeight();
            await failTransaction(this.orm, txId, `Current ledger ${currentBlock} >= last transaction ledger ${txEnt.executeUntilBlock}`);
         }
         //TODO fail for now
         //await this.tryToReplaceByFee(txHash);
         await failTransaction(this.orm, txId, `Need to implement rbf`);
      }
   }

   private async tryToReplaceByFee(txHash: string): Promise<ISubmitTransactionResponse> {
      throw new Error(`Cannot replaceByFee transaction ${txHash}.`);
      /*
const retryTx = await fetchTransactionEntity(this.orm, txHash);
const newTransaction = JSON.parse(retryTx.raw.toString());
const newFee = newTransaction.getFee() * this.feeIncrease;
if (this.checkIfFeeTooHigh(toBN(newFee), retryTx.maxFee)) {
   await updateTransactionEntity(this.orm, txHash, async (txEnt) => {
      txEnt.status = TransactionStatus.TX_FAILED;
   });
   throw new Error(`Transaction ${txHash} failed due to fee restriction`)
}
const privateKey = ""; //TODO fetch private key from
const blob = await this.signTransaction(newTransaction, privateKey);
const submitResp = await this.submitTransaction(blob);
const submittedBlockHeight = await this.getCurrentBlockHeight();
await createTransactionEntity(this.orm, newTransaction, retryTx.source, retryTx.destination, submitResp.txId, submittedBlockHeight, retryTx.maxFee);
const newTxEnt = await fetchTransactionEntity(this.orm, submitResp.txId);
await updateTransactionEntity(this.orm, txHash, async (txEnt) => {
   txEnt.replaced_by = newTxEnt;
   txEnt.status = TransactionStatus.TX_REPLACED;
});
await this.waitForTransactionToAppearInMempool(submitResp.txId, 1);
return submitResp;*/
   }

   private checkIfFeeTooHigh(fee: BN, maxFee?: BN | null): boolean {
      if (maxFee && fee.gt(maxFee)) {
         return true;
      }
      return false;
   }

   private getCore(): typeof bitcore {
      if (this.chainType === ChainType.DOGE || this.chainType === ChainType.testDOGE) {
         return dogecore;
      } else {
         return bitcore;
      }
   }

   private getDustAmount(): BN {
      if (this.chainType === ChainType.DOGE || this.chainType === ChainType.testDOGE) {
         return DOGE_DUST_AMOUNT;
      } else {
         return BTC_DUST_AMOUNT;
      }
   }

   /**
    * @returns default fee per byte
    */
   private getDefaultFeePerB(): BN {
      if (this.chainType === ChainType.DOGE || this.chainType === ChainType.testDOGE) {
         return DOGE_FEE_PER_KB.divn(1000);
      } else {
         return BTC_FEE_PER_KB.divn(1000);
      }
   }

   private getEstimateFee(inputLength: number, outputLength: number = 2): BN {
      return this.getDefaultFeePerB().muln(inputLength * UTXO_INPUT_SIZE + outputLength * UTXO_OUTPUT_SIZE + UTXO_OVERHEAD_SIZE);
   }

   private getEstimatedNumberOfOutputs(amountInSatoshi: BN | null, note?: string) {
      if (amountInSatoshi == null && note) return 2; // destination and note
      if (amountInSatoshi == null && !note) return 1; // destination
      if (note) return 3; // destination, change (returned funds) and note
      return 2; // destination and change
   }

   private async checkIfShouldStillSubmit(executeUntilBlock: number | null): Promise<boolean> {
      const currentBlockHeight = await this.getCurrentBlockHeight();
      if (executeUntilBlock && currentBlockHeight - executeUntilBlock > this.executionBlockOffset) {
         return false;
      }
      return true;
   }
}
