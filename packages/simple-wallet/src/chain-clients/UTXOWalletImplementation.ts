import axios, { AxiosInstance, AxiosRequestConfig } from "axios";
import axiosRateLimit from "../axios-rate-limiter/axios-rate-limit";
import bs58check from "bs58check";
import * as bitcoin from "bitcoinjs-lib";
import * as bitcore from "bitcore-lib";
import * as litecore from "bitcore-lib-ltc";
import * as dogecore from "bitcore-lib-doge";
import BIP32Factory from "bip32";
import { generateMnemonic, mnemonicToSeedSync } from "bip39";
import { excludeNullFields, getAvgBlockTime, getCurrentNetwork, sleepMs, stuckTransactionConstants, unPrefix0x, wallet_utxo_ensure_data } from "../utils/utils";
import { toBN, toNumber } from "../utils/bnutils";
import {
   BTC_LTC_DUST_AMOUNT,
   BTC_LTC_FEE_PER_KB,
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
import { ORM, createTransactionEntity, fetchTransactionEntity, updateTransactionEntity } from "../orm/orm";
import { TransactionStatus } from "../entity/transaction";

export abstract class UTXOWalletImplementation implements WriteWalletInterface {
   inTestnet: boolean;
   client: AxiosInstance;
   blockOffset: number;
   maxRetries: number;
   feeIncrease: number;
   orm!: ORM;

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
      const resubmit = stuckTransactionConstants(this.chainType);
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      this.blockOffset = createConfig.stuckTransactionOptions?.blockOffset ?? resubmit.blockOffset!;
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      this.maxRetries = createConfig.stuckTransactionOptions?.retries ?? resubmit.retries!;
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      this.feeIncrease = createConfig.stuckTransactionOptions?.feeIncrease ?? resubmit.feeIncrease!;
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
      maxFeeInSatoshi?: BN
   ): Promise<ISubmitTransactionResponse> {
      const transaction = await this.preparePaymentTransaction(source, destination, amountInSatoshi, feeInSatoshi, note, maxFeeInSatoshi);
      const tx_blob = await this.signTransaction(transaction, privateKey);
      const submitResp = await this.submitTransaction(tx_blob);
      // save tx in db
      await createTransactionEntity(this.orm, transaction, source, destination, submitResp.txId, maxFeeInSatoshi || null);
      const submittedBlockHeight = await this.getCurrentBlockHeight();
      return await this.waitForTransaction(submitResp.txId, source, privateKey, submittedBlockHeight);
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

   getReplacedOrTransactionHash(transactionHash: string): Promise<string> {
      throw new Error("Method not implemented.");
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
    * @returns {Object} - BTC/DOGE/LTC transaction object
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
      this.checkFeeRestriction(toBN(tr.getFee()), maxFeeInSatoshi);
      if (note) {
         tr.addData(Buffer.from(unPrefix0x(note), "hex"));
      }
      tr.enableRBF();
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
      return utxos.map((utxo) => ({
         txid: utxo.mintTxid,
         satoshis: utxo.value,
         outputIndex: utxo.mintIndex,
         confirmations: utxo.confirmations,
         scriptPubKey: utxo.script,
      }));
   }

   /**
    * Retrieves unspent transactions
    * @param {string} address
    * @param {BN|null} amountInSatoshi - if null => empty all funds
    * @param {number} estimatedNumOfOutputs
    * @returns {Object[]}
    */
   private async listUnspent(address: string, amountInSatoshi: BN | null, estimatedNumOfOutputs: number): Promise<any[]> {
      const res = await this.client.get(`/address/${address}?unspent=true&excludeconflicting=true`);
      wallet_utxo_ensure_data(res);
      // https://github.com/bitpay/bitcore/blob/405f8b17dbb537277bea89ca131214793e577151/packages/bitcore-node/src/types/Coin.ts#L26
      // utxo.mintHeight > -3 => excludeConflicting
      const allUTXOs =  (res.data as any[]).filter((utxo) => utxo.mintHeight > -3).sort((a, b) => a.value - b.value);
      if (amountInSatoshi == null) {
         return allUTXOs;
      }
      const neededUTXOs = [];
      let sum = 0;
      for (const utxo of allUTXOs) {
         neededUTXOs.push(utxo);
         sum += utxo.value;
         const est_fee = this.getEstimateFee(neededUTXOs.length, estimatedNumOfOutputs);
         // multiply estimated fee by 2 to ensure enough funds TODO: is it enough?
         if (toBN(sum).gt(amountInSatoshi.add(est_fee.muln(2)))) {
            return neededUTXOs;
         }
      }
      return allUTXOs;
   }

   async getCurrentBlockHeight(): Promise<number> {
      const res = await this.client.get(`/block/tip`);
      wallet_utxo_ensure_data(res);
      return res.data.height;
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
   private async waitForTransaction(txHash: string, source: string, privateKey: string, submittedBlockHeight: number, retry: number = 0): Promise<ISubmitTransactionResponse> {
      await sleepMs(getAvgBlockTime(this.chainType));
      const txResp = await this.client.get(`/tx/${txHash}`);
      wallet_utxo_ensure_data(txResp);
      if (txResp.data.blockHash) {
         await updateTransactionEntity(this.orm, txHash, async (txEnt) => {
            txEnt.confirmations = txResp.data.confirmations;
            txEnt.status = TransactionStatus.TX_SUCCESS;
         });
         return { txId: txResp.data.txid };
      }
      return this.tryToResubmitTransaction(txHash, source, privateKey, submittedBlockHeight, retry);
   }

   /**
    * @param {string} txHash
    * @param {Object} source
    * @param {string} privateKey
    * @param {number} submittedBlockHeight
    * @param {number} retry
    * @returns {Object} - containing transaction id tx_id and optional result
    */
   private async tryToResubmitTransaction(txHash: string, source: string, privateKey: string, submittedBlockHeight: number, retry: number): Promise<ISubmitTransactionResponse> {
      const retriedTx = await fetchTransactionEntity(this.orm, txHash);
      const lastBlockNumber = submittedBlockHeight + this.blockOffset;
      const currentBlockHeight = await this.getCurrentBlockHeight();
      if (currentBlockHeight > lastBlockNumber) {
         if (retry <= this.maxRetries) {
            const newTransaction = JSON.parse(retriedTx.raw.toString());
            const newFee = newTransaction.getFee() * this.feeIncrease;
            this.checkFeeRestriction(toBN(newFee), retriedTx.maxFee);
            newTransaction.fee(newFee);
            const blob = await this.signTransaction(newTransaction, privateKey);
            const submit = await this.submitTransaction(blob);
            const newSubmittedBlockHeight = await this.getCurrentBlockHeight();
            // store new tx and mark replacement
            await createTransactionEntity(this.orm, newTransaction, retriedTx.source, retriedTx.destination, submit.txId);
            const newTxEnt = await fetchTransactionEntity(this.orm, submit.txId);
            await updateTransactionEntity(this.orm, txHash, async (txEnt) => {
               txEnt.replaced_by = newTxEnt;
               txEnt.status = TransactionStatus.TX_REPLACED;
            });
            retry++;
            return this.waitForTransaction(submit.txId, source, privateKey, newSubmittedBlockHeight, retry);
         }
         await updateTransactionEntity(this.orm, txHash, async (txEnt) => {
            txEnt.status = TransactionStatus.TX_NOT_ACCEPTED;
         });
         throw new Error(
            `waitForTransaction: transaction ${txHash} is not going to be accepted. Current block ${currentBlockHeight} is greater than submittedBlockHeight ${lastBlockNumber}`
         );
      }
      return this.waitForTransaction(txHash, source, privateKey, submittedBlockHeight, retry);
   }

   private checkFeeRestriction(fee: BN, maxFee?: BN | null): void {
      if (maxFee && fee.gt(maxFee)) {
         throw Error(`Fee ${fee.toString()} is higher than maxFee ${maxFee.toString()}`);
      }
   }

   private getCore(): typeof bitcore {
      if (this.chainType === ChainType.DOGE || this.chainType === ChainType.testDOGE) {
         return dogecore;
      } else if (this.chainType === ChainType.LTC || this.chainType === ChainType.testLTC) {
         return litecore;
      } else {
         return bitcore;
      }
   }

   private getDustAmount(): BN {
      if (this.chainType === ChainType.DOGE || this.chainType === ChainType.testDOGE) {
         return DOGE_DUST_AMOUNT;
      } else {
         return BTC_LTC_DUST_AMOUNT;
      }
   }

   /**
    * @returns default fee per byte
    */
   private getDefaultFeePerB(): BN {
      if (this.chainType === ChainType.DOGE || this.chainType === ChainType.testDOGE) {
         return DOGE_FEE_PER_KB.divn(1000);
      } else {
         return BTC_LTC_FEE_PER_KB.divn(1000);
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
}
