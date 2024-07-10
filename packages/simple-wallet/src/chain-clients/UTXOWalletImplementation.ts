import axios, { AxiosInstance, AxiosRequestConfig } from "axios";
import axiosRateLimit from "../axios-rate-limiter/axios-rate-limit";
import bs58check from "bs58check";
import * as bitcoin from "bitcoinjs-lib";
import * as bitcore from "bitcore-lib";
import * as dogecore from "bitcore-lib-doge";
import BIP32Factory from "bip32";
import { generateMnemonic, mnemonicToSeedSync } from "bip39";
import { excludeNullFields, getAvgBlockTime, getCurrentNetwork, sleepMs, stuckTransactionConstants, unPrefix0x, wallet_utxo_ensure_data } from "../utils/utils";
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
import type { BaseWalletConfig, UTXOFeeParams } from "../interfaces/WriteWalletInterface";
import type { ICreateWalletResponse, ISubmitTransactionResponse, UTXO, WriteWalletInterface } from "../interfaces/WriteWalletInterface";
// eslint-disable-next-line @typescript-eslint/no-var-requires
const UnspentOutput = require("bitcore-lib/lib/transaction/unspentoutput");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const ecc = require('tiny-secp256k1');
// You must wrap a tiny-secp256k1 compatible implementation
const bip32 = BIP32Factory(ecc);
import BN from "bn.js";
import { TransactionStatus } from "../entity/transaction";
import { ORM } from "../orm/mikro-orm.config";
import { createTransactionEntity, fetchTransactionEntity, fetchUnspentUTXOs, getReplacedTransactionHash, storeUTXOS, updateTransactionEntity, updateUTXOEntity } from "../utils/dbutils";
import { SpentHeightEnum, UTXOEntity } from "../entity/utxo";

export abstract class UTXOWalletImplementation implements WriteWalletInterface {
   inTestnet: boolean;
   client: AxiosInstance;
   orm!: ORM;

   addressLocks = new Set<string>();
   enoughConfirmations: number = 2;
   executionBlockOffset: number = 2;
   feeIncrease: number = 1.3;
   addressLockTime: number = 120000; // 2min
   mempoolWaitingTime: number = 60000; // 1min

   constructor(public chainType: ChainType, createConfig: BaseWalletConfig) {
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
   }

   /**
    * @returns {Object} - wallet with auto generated mnemonic
    */
   createWallet(): ICreateWalletResponse {
      const mnemonic = generateMnemonic();
      return this.createWalletFromMnemonic(mnemonic);
   }

   /**
    * @param {string} mnemonic - mnemonic used for wallet creation
    * @returns {Object} - wallet
    */
   createWalletFromMnemonic(mnemonic: string): ICreateWalletResponse {
      const seed: Buffer = mnemonicToSeedSync(mnemonic);
      const actualNetwork = getCurrentNetwork(this.chainType);

      const node = bip32.fromSeed(seed, actualNetwork);
      const path = actualNetwork.bip32Path;
      const child0 = node.derivePath(path);
      //node.neutered().toBase58()//xpublic_key
      //node.toBase58()//xprivate_key
      const payload = Buffer.allocUnsafe(21);
      payload.writeUInt8(actualNetwork.pubKeyHash, 0);
      const hash = bitcoin.crypto.hash160(child0.publicKey);
      hash.copy(payload, 1);
      const address = bs58check.encode(payload);

      return {
         address: address as string,
         mnemonic: mnemonic,
         privateKey: child0.toWIF(),
         // publicKey: child.publicKey
      };
   }

   /**
    * @param {string} account
    * @returns {BN} - confirmed balance in satoshis
    */
   async getAccountBalance(account: string): Promise<BN> {
      const res = await this.client.get(`/address/${account}/balance`);
      wallet_utxo_ensure_data(res);
      return toBN(res.data.balance);
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
   async prepareAndExecuteTransaction(
      source: string,
      privateKey: string,
      destination: string,
      amountInSatoshi: BN | null,
      feeInSatoshi?: BN,
      note?: string,
      maxFeeInSatoshi?: BN,
      executeUntilBlock?: number
   ): Promise<ISubmitTransactionResponse> {
      await this.checkIfCanSubmitFromAddress(source);
      if(!await this.checkIfShouldStillSubmit(executeUntilBlock || null)) {
         throw new Error(`Transaction will not be prepared due to limit block restriction`);
      }
      try {
         // lock address until transaction is visible in mempool
         this.addressLocks.add(source);
         const transaction = await this.preparePaymentTransaction(source, destination, amountInSatoshi, feeInSatoshi, note, maxFeeInSatoshi);
         const tx_blob = await this.signTransaction(transaction, privateKey);
         const submitResp = await this.submitTransaction(tx_blob);
         // save tx in db
         await createTransactionEntity(this.orm, transaction, source, destination, submitResp.txId, maxFeeInSatoshi || null);
         // mark utxo as spent
         for (const input of transaction.inputs) {
            await updateUTXOEntity(this.orm, input.prevTxId.toString('hex'), input.outputIndex, async (utxoEnt) => {
               utxoEnt.spentHeight = SpentHeightEnum.PENDING;
            });
         }
         await this.waitForTransactionToAppearInMempool(submitResp.txId, privateKey, 0, executeUntilBlock);
         //TODO do this in background
         void this.waitForTransactionToBeAccepted(submitResp.txId, source, privateKey);
         return submitResp;
      } finally {
         this.addressLocks.delete(source);
      }
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
   async deleteAccount(
      source: string,
      privateKey: string,
      destination: string,
      feeInSatoshi?: BN,
      note?: string,
      maxFeeInSatoshi?: BN
   ): Promise<ISubmitTransactionResponse> {
      return await this.prepareAndExecuteTransaction(source, privateKey, destination, null, feeInSatoshi, note, maxFeeInSatoshi);
   }

   /**
    * @param {string} transactionHash
    * @returns {string} - transactionHash or replaced transactionHash
    */
   async getReplacedOrTransactionHash(transactionHash: string): Promise<string> {
      return getReplacedTransactionHash(this.orm, transactionHash);
   }

   ///////////////////////////////////////////////////////////////////////////////////////
   // HELPER OR CLIENT SPECIFIC FUNCTIONS ////////////////////////////////////////////////
   ///////////////////////////////////////////////////////////////////////////////////////

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
      maxFeeInSatoshi?: BN
   ): Promise<bitcore.Transaction> {
      const isPayment = amountInSatoshi != null;
      const core = this.getCore();
      const utxos = await this.fetchUTXOs(source, amountInSatoshi, this.getEstimatedNumberOfOutputs(amountInSatoshi, note));
      if (amountInSatoshi == null) {
         const estimateFee = this.getEstimateFee(utxos.length);
         amountInSatoshi = (await this.getAccountBalance(source)).sub(estimateFee);
      }
      if (amountInSatoshi.lte(this.getDustAmount())) {
         throw new Error(`Will not prepare transaction for ${source}. Amount ${amountInSatoshi.toString()} is less than dust ${this.getDustAmount().toString()}`)
      }
      const tr = new core.Transaction()
         .from(utxos.map((utxo) => new UnspentOutput(utxo)))
         .to(destination, toNumber(amountInSatoshi));
      if (isPayment) {
         tr.change(source);
      }
      if (feeInSatoshi) {
         tr.fee(toNumber(feeInSatoshi));
      }
      if(this.checkIfFeeTooHigh(toBN(tr.getFee()), maxFeeInSatoshi)) {
         throw new Error(`Transaction preparation failed due to fee restriction (fee: ${tr.getFee()}, maxFee: ${maxFeeInSatoshi?.toString()})`);
      }
      if (note) {
         tr.addData(Buffer.from(unPrefix0x(note), "hex"));
      }
      tr.enableRBF();
      if (isPayment && !feeInSatoshi) {
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
   private async signTransaction(transaction: bitcore.Transaction, privateKey: string): Promise<string> {
      const signed = transaction.sign(privateKey).serialize();
      return signed;
   }

   /**
    * @param {string} signedTx
    * @returns {Object} - containing transaction id tx_id and optional result
    */
   private async submitTransaction(signedTx: string): Promise<ISubmitTransactionResponse> {
      const res = await this.client.post(`/tx/send`, { rawTx: signedTx });
      wallet_utxo_ensure_data(res);
      return { txId: res.data.txid };
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
         const raw = JSON.parse(utxo.raw.toString());
         const item = {
            txid: utxo.mintTransactionHash,
            satoshis: raw.satoshis,
            outputIndex: utxo.position,
            confirmations: -1,
            scriptPubKey: raw.script,
         }
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

      const needed = await this.returnNeededUTXOs(dbUTXOS, estimatedNumOfOutputs, amountInSatoshi)
      if (needed) {
         return needed;
      }
      // not enough funds in db
      await this.fillUTXOsFromMempool(address);
      dbUTXOS = await fetchUnspentUTXOs(this.orm, address);
      const neededAfter = await this.returnNeededUTXOs(dbUTXOS, estimatedNumOfOutputs, amountInSatoshi)
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
         const value = JSON.parse(utxo.raw.toString()).satoshis;
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
      wallet_utxo_ensure_data(res);
      // https://github.com/bitpay/bitcore/blob/405f8b17dbb537277bea89ca131214793e577151/packages/bitcore-node/src/types/Coin.ts#L26
      // utxo.mintHeight > -3 => excludeConflicting; utxo.spentHeight == -2 -> unspent
      const mempoolUTXOs = (res.data as any[]).filter((utxo) => utxo.mintHeight > -3 && utxo.spentHeight == -2).sort((a, b) => a.value - b.value);
      await storeUTXOS(this.orm, address, mempoolUTXOs);
   }

   async getCurrentBlockHeight(): Promise<number> {
      const res = await this.client.get(`/block/tip`);
      wallet_utxo_ensure_data(res);
      return res.data.height;
   }

   private async waitForTransactionToAppearInMempool(txHash: string, privateKey: string, retry: number = 0, executeUntilBlock: number | null = null): Promise<ISubmitTransactionResponse> {
      const start = new Date().getTime();
      while (new Date().getTime() - start < this.mempoolWaitingTime) {
         try {
            const txResp = await this.client.get(`/tx/${txHash}`);
            if (txResp) {
               return { txId: txResp.data.txid };
            }
         } catch (e) { /* empty */ }
         await sleepMs(1000);
      }
      // transaction was not accepted in mempool by one minute => replace by fee one time
      if (retry > 0) {
         await updateTransactionEntity(this.orm, txHash, async (txEnt) => {
            txEnt.status = TransactionStatus.TX_FAILED;
         });
         throw new Error('Transaction was not accepted in mempool.');
      } else {
         if (!await this.checkIfShouldStillSubmit(executeUntilBlock || null)){
            await updateTransactionEntity(this.orm, txHash, async (txEnt) => {
               txEnt.status = TransactionStatus.TX_FAILED;
            });
            throw new Error(`Transaction ${txHash} failed due to limit block restriction`);
         }
         return await this.tryToReplaceByFee(txHash, privateKey);
      }
   }
   /**
    * Returns transaction object when transaction is accepted to the ledger
    * @param {string} txHash
    * @param {string} source
    * @param {string} privateKey
    * @param {number} submittedBlockHeight
    * @param {string} retry
    * @returns {Object} - containing transaction id tx_id and optional result
    */
   private async waitForTransactionToBeAccepted(txHash: string, source: string, privateKey: string): Promise<ISubmitTransactionResponse> {
      const submittedBlockHeight = await this.getCurrentBlockHeight();
      await sleepMs(getAvgBlockTime(this.chainType));
      let txResp = await this.client.get(`/tx/${txHash}`);
      wallet_utxo_ensure_data(txResp);
      while (!(txResp.data.blockHash &&txResp.data.confirmations >= this.enoughConfirmations)) {
         await sleepMs(getAvgBlockTime(this.chainType));
         txResp = await this.client.get(`/tx/${txHash}`);
         //TODO handle stuck transactions -> if not accepted in next two block?: could do rbf, but than all dependant will change too!
         const currentBlockHeight =  await this.getCurrentBlockHeight();
         if (currentBlockHeight - submittedBlockHeight > this.enoughConfirmations) {
            throw new Error(`Transaction ${txHash} is probably not going to be accepted!`);
         }
      }
      await updateTransactionEntity(this.orm, txHash, async (txEnt) => {
         txEnt.confirmations = txResp.data.confirmations;
         txEnt.status = TransactionStatus.TX_SUCCESS;
      });
      return { txId: txResp.data.txid };
   }

   private async tryToReplaceByFee(txHash: string, privateKey: string): Promise<ISubmitTransactionResponse> {
      const retryTx = await fetchTransactionEntity(this.orm, txHash);
      const newTransaction = JSON.parse(retryTx.raw.toString());
      const newFee = newTransaction.getFee() * this.feeIncrease;
      if (this.checkIfFeeTooHigh(toBN(newFee), retryTx.maxFee)) {
         await updateTransactionEntity(this.orm, txHash, async (txEnt) => {
            txEnt.status = TransactionStatus.TX_FAILED;
         });
         throw new Error(`Transaction ${txHash} failed due to fee restriction`)
      }
      const blob = await this.signTransaction(newTransaction, privateKey);
      const submitResp = await this.submitTransaction(blob);
      await createTransactionEntity(this.orm, newTransaction, retryTx.source, retryTx.destination, submitResp.txId);
      const newTxEnt = await fetchTransactionEntity(this.orm, submitResp.txId);
      await updateTransactionEntity(this.orm, txHash, async (txEnt) => {
         txEnt.replaced_by = newTxEnt;
         txEnt.status = TransactionStatus.TX_REPLACED;
      });
      await this.waitForTransactionToAppearInMempool(submitResp.txId, privateKey, 1);
      //TODO do this in background
      void this.waitForTransactionToBeAccepted(submitResp.txId, retryTx.source, privateKey);
      return submitResp;
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

   private getEstimatedNumberOfOutputs(amountInSatoshi:BN | null, note?: string) {
      if (amountInSatoshi == null && note) return 2; // destination and note
      if (amountInSatoshi == null && !note) return 1; // destination
      if (note) return 3; // destination, change (returned funds) and note
      return 2; // destination and change
   }

   /**
    * Waits if previous transaction from address is still processing. If wait is too long it throws.
    * @param {string} address
    */
   private async checkIfCanSubmitFromAddress(address: string): Promise<void> {
      const start = new Date().getTime();
      while (new Date().getTime() - start < this.addressLockTime) {
         if (!this.addressLocks.has(address)) {
            this.addressLocks.add(address);
            return;
         }
         await sleepMs(100);
      }
      throw new Error(`Timeout waiting to obtain confirmed transaction from address ${address}`);
   }

   private async checkIfShouldStillSubmit(executeUntilBlock: number | null): Promise<boolean> {
      const currentBlockHeight = await this.getCurrentBlockHeight();
      if (executeUntilBlock && (executeUntilBlock - currentBlockHeight) > this.executionBlockOffset) {
         return false;
      }
      return true;
   }
}
