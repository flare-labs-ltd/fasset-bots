import axios, { AxiosInstance, AxiosRequestConfig } from "axios";
import axiosRateLimit from "../axios-rate-limiter/axios-rate-limit";
import bs58check from "bs58check";
import * as bitcoin from "bitcoinjs-lib";
import * as bitcore from "bitcore-lib";
import * as litecore from "bitcore-lib-ltc";
import * as dogecore from "bitcore-lib-doge";
import BIP32Factory from "bip32";
import { generateMnemonic, mnemonicToSeedSync } from "bip39";
import { excludeNullFields, getAvgBlockTime, getCurrentNetwork, getTimeLockForAddress, sleepMs, stuckTransactionConstants, toBN, toNumber, wallet_utxo_ensure_data } from "../utils/utils";
import {
   ChainType,
   DEFAULT_RATE_LIMIT_OPTIONS,
} from "../utils/constants";
import type { BaseRpcConfig } from "../interfaces/WriteWalletRpcInterface";
import type { ICreateWalletResponse, ISubmitTransactionResponse, UTXO, WriteWalletRpcInterface } from "../interfaces/WriteWalletRpcInterface";
// eslint-disable-next-line @typescript-eslint/no-var-requires
const UnspentOutput = require("bitcore-lib/lib/transaction/unspentoutput");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const ecc = require('tiny-secp256k1');
// You must wrap a tiny-secp256k1 compatible implementation
const bip32 = BIP32Factory(ecc);
import BN from "bn.js";

export abstract class BtcishWalletImplementation implements WriteWalletRpcInterface {
   inTestnet: boolean;
   client: AxiosInstance;
   addressLocks = new Map<string, { tx: bitcore.Transaction | null; maxFee: BN | null }>();
   blockOffset: number;
   timeoutAddressLock: number;
   maxRetries: number;
   feeIncrease: number;

   constructor(public chainType: ChainType, createConfig: BaseRpcConfig) {
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
      this.timeoutAddressLock = getTimeLockForAddress(this.chainType, this.blockOffset, this.maxRetries);
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
      const child = node.derivePath(path);
      //node.neutered().toBase58()//xpublic_key
      //node.toBase58()//xprivate_key
      const payload = Buffer.allocUnsafe(21);
      payload.writeUInt8(actualNetwork.pubKeyHash, 0);
      const hash = bitcoin.crypto.hash160(child.publicKey);
      hash.copy(payload, 1);
      const address = bs58check.encode(payload);

      return {
         address: address as string,
         mnemonic: mnemonic,
         privateKey: child.toWIF(),
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
    * @returns {BN} - current transaction/network fee in satoshis
    */
   async getCurrentTransactionFee(): Promise<BN> {
      const averageTxSize = 500; //kb
      if (this.chainType === ChainType.DOGE || this.chainType === ChainType.testDOGE) {
         // https://github.com/bitpay/bitcore/blob/master/packages/bitcore-lib-doge/lib/transaction/transaction.js
         return toBN((100000000 * averageTxSize) / 1000);
      } else {
         // https://github.com/bitpay/bitcore/blob/master/packages/bitcore-lib-ltc/lib/transaction/transaction.js
         // https://github.com/bitpay/bitcore/blob/master/packages/bitcore-lib/lib/transaction/transaction.js
         return toBN((100000 * averageTxSize) / 1000);
      }
   }

   /**
    * @param {string} source
    * @param {string} destination
    * @param {BN} amountInSatoshi
    * @param {BN|undefined} feeInSatoshi - automatically set if undefined
    * @param {string} note
    * @param {BN|undefined} maxFeeInSatoshi
    * @returns {Object} - BTC/DOGE/LTC transaction object
    */
   async preparePaymentTransaction(
      source: string,
      destination: string,
      amountInSatoshi: BN,
      feeInSatoshi?: BN,
      note?: string,
      maxFeeInSatoshi?: BN
   ): Promise<bitcore.Transaction> {
      const utxos = await this.fetchUTXOs(source);
      const core = this.getCore();
      const tr = new core.Transaction()
         .from(utxos.map((utxo) => new UnspentOutput(utxo)))
         .to(destination, toNumber(amountInSatoshi))
         .change(source);
      // Default fee is 1 DOGE, 0.001 LTC and 0.001 BTC according to bitcore-lib libraries
      if (feeInSatoshi) {
         tr.fee(toNumber(feeInSatoshi));
      }
      this.checkFeeRestriction(toBN(tr.getFee()), maxFeeInSatoshi);
      if (note) {
         tr.addData(Buffer.from(note, "hex"));
      }
      tr.enableRBF();
      return tr;
   }

   /**
    * @param {Object} transaction
    * @param {string} privateKey
    * @returns {string} - hex string
    */
   async signTransaction(transaction: bitcore.Transaction, privateKey: string): Promise<string> {
      const signed = transaction.sign(privateKey).serialize();
      return signed;
   }

   /**
    * @param {string} signedTx
    * @returns {Object} - containing transaction id tx_id and optional result
    */
   async submitTransaction(signedTx: string): Promise<ISubmitTransactionResponse> {
      const res = await this.client.post(`/tx/send`, { rawTx: signedTx });
      wallet_utxo_ensure_data(res);
      return { txId: res.data.txid };
   }

   async executeLockedSignedTransactionAndWait(
      source: string,
      privateKey: string,
      destination: string,
      amountInSatoshi: BN,
      feeInSatoshi?: BN,
      note?: string,
      maxFeeInSatoshi?: BN
   ): Promise<ISubmitTransactionResponse> {
      await this.checkIfCanSubmitFromAddress(source);
      try {
         const transaction = await this.preparePaymentTransaction(source, destination, amountInSatoshi, feeInSatoshi, note, maxFeeInSatoshi);
         this.addressLocks.set(source, { tx: transaction, maxFee: maxFeeInSatoshi ? maxFeeInSatoshi : null });
         const tx_blob = await this.signTransaction(transaction, privateKey);
         const submitResp = await this.submitTransaction(tx_blob);
         const submittedBlockHeight = await this.getCurrentBlockHeight();
         return await this.waitForTransaction(submitResp.txId, source, privateKey, submittedBlockHeight);
      } finally {
         this.addressLocks.delete(source);
      }
   }
   ///////////////////////////////////////////////////////////////////////////////////////
   // HELPER OR CLIENT SPECIFIC FUNCTIONS ////////////////////////////////////////////////
   ///////////////////////////////////////////////////////////////////////////////////////

   /**
    * Waits if previous transaction from address is still processing. If wait is too long it throws.
    * @param {string} address
    */
   async checkIfCanSubmitFromAddress(address: string): Promise<void> {
      const start = new Date().getTime();
      while (new Date().getTime() - start < this.timeoutAddressLock) {
         if (!this.addressLocks.get(address)) {
            this.addressLocks.set(address, { tx: null, maxFee: null });
            return;
         }
         await sleepMs(1000);
      }
      throw new Error(`Timeout waiting to obtain confirmed transaction from address ${address}`);
   }

   /**
    * Retrieves unspent transactions in format accepted by transaction
    * @param {string} address
    * @returns {Object[]}
    */
   async fetchUTXOs(address: string): Promise<UTXO[]> {
      const utxos = (await this.listUnspent(address)).filter((utxo) => utxo.mintHeight >= 0);
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
    * @returns {Object[]}
    */
   async listUnspent(address: string): Promise<any[]> {
      const res = await this.client.get(`/address/${address}/?unspent=true`);
      wallet_utxo_ensure_data(res);
      return res.data;
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
    * @param {string} retry
    * @returns {Object} - containing transaction id tx_id and optional result
    */
   async waitForTransaction(txHash: string, source: string, privateKey: string, submittedBlockHeight: number, retry: number = 0): Promise<ISubmitTransactionResponse> {
      await sleepMs(getAvgBlockTime(this.chainType));
      const txResp = await this.client.get(`/tx/${txHash}`);
      wallet_utxo_ensure_data(txResp);
      if (txResp.data.blockHash) {
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
   async tryToResubmitTransaction(txHash: string, source: string, privateKey: string, submittedBlockHeight: number, retry: number): Promise<ISubmitTransactionResponse> {
      const res = this.addressLocks.get(source);
      const transaction = res?.tx;
      if (!transaction) {
         throw new Error(`waitForTransaction: transaction ${txHash} for source ${source} cannot be found`);
      }
      const lastBlockNumber = submittedBlockHeight + this.blockOffset;
      const currentBlockHeight = await this.getCurrentBlockHeight();
      if (currentBlockHeight > lastBlockNumber) {
         if (retry <= this.maxRetries) {
            const newTransaction = transaction;
            const newFee = newTransaction.getFee() * this.feeIncrease;
            this.checkFeeRestriction(toBN(newFee), res.maxFee);
            newTransaction.fee(newFee);
            this.addressLocks.set(source, { tx: newTransaction, maxFee: res.maxFee });
            const blob = await this.signTransaction(newTransaction, privateKey);
            const submit = await this.submitTransaction(blob);
            const newSubmittedBlockHeight = await this.getCurrentBlockHeight();
            retry++;
            return this.waitForTransaction(submit.txId, source, privateKey, newSubmittedBlockHeight, retry);
         }
         throw new Error(
            `waitForTransaction: transaction ${txHash} is not going to be accepted. Current block ${currentBlockHeight} is greater than submittedBlockHeight ${lastBlockNumber}`
         );
      }
      return this.waitForTransaction(txHash, source, privateKey, submittedBlockHeight, retry);
   }

   checkFeeRestriction(fee: BN, maxFee?: BN | null): void {
      if (maxFee && fee.gt(maxFee)) {
         throw Error(`Transaction is not prepared: fee ${fee} is higher than maxFee ${maxFee.toString()}`);
      }
   }

   getCore(): typeof bitcore {
      if (this.chainType === ChainType.DOGE || this.chainType === ChainType.testDOGE) {
         return dogecore;
      } else if (this.chainType === ChainType.LTC || this.chainType === ChainType.testLTC) {
         return litecore;
      } else return bitcore;
   }
}
