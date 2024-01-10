import axios, { AxiosInstance } from "axios";
import axiosRateLimit from "../axios-rate-limiter/axios-rate-limit";
import algosdk from "algosdk";
import { sleepMs, stringToUint8Arr, uint8ArrToString, algo_ensure_data, toBN, toNumber, excludeNullFields } from "../utils/utils";
import { ChainType, DEFAULT_RATE_LIMIT_OPTIONS, ALGO_LEDGER_CLOSE_TIME_MS } from "../utils/constants";
import type { ICreateWalletResponse, ISubmitTransactionResponse, WriteWalletRpcInterface } from "../interfaces/WriteWalletRpcInterface";
import type { AlgoRpcConfig } from "../interfaces/WriteWalletRpcInterface";
import BN from "bn.js";

function algoResponseValidator(responseCode: number) {
   // allow any response, process them later in mcc
   return responseCode >= 200 && responseCode < 600;
}

export class AlgoWalletImplementation implements WriteWalletRpcInterface {
   chainType: ChainType;
   inTestnet: boolean;
   algodClient: AxiosInstance;

   constructor(createConfig: AlgoRpcConfig) {
      this.inTestnet = createConfig.inTestnet ?? false;
      this.chainType = ChainType.ALGO;
      const client = axios.create({
         baseURL: createConfig.url,
         headers: excludeNullFields({
            "Content-Type": "application/json",
            "X-Algo-API-Token": createConfig.apiTokenKey,
            "x-api-key": createConfig.apiTokenKey
         }),
         auth: (createConfig.username && createConfig.password) ? {
            username: createConfig.username,
            password: createConfig.password,
         } : undefined,
         timeout: createConfig.rateLimitOptions?.timeoutMs
            ?? DEFAULT_RATE_LIMIT_OPTIONS.timeoutMs,
         validateStatus: algoResponseValidator,
      });
      this.algodClient = axiosRateLimit(client, {
         ...DEFAULT_RATE_LIMIT_OPTIONS,
         ...createConfig.rateLimitOptions,
      });
   }

   async executeLockedSignedTransactionAndWait(): Promise<any> {
      throw new Error("Method not implemented.");
   }

   /**
    * @returns {Object} - wallet with auto generated mnemonic
    */
   createWallet(): ICreateWalletResponse {
      const resp = algosdk.generateAccount();
      const mn = algosdk.secretKeyToMnemonic(resp.sk);
      const sk = uint8ArrToString(resp.sk);
      return {
         privateKey: sk,
         address: resp.addr,
         mnemonic: mn,
      } as ICreateWalletResponse;
   }

   /**
    * @param {string} mnemonic - mnemonic used for wallet creation
    * @returns {Object} - wallet
    */
   createWalletFromMnemonic(mnemonic: string): ICreateWalletResponse {
      const seed = algosdk.mnemonicToSecretKey(mnemonic);
      const sk = uint8ArrToString(seed.sk);
      return {
         privateKey: sk,
         address: seed.addr,
         mnemonic: mnemonic,
      } as ICreateWalletResponse;
   }

   /**
    * @param {string} account
    * @returns {BN} - balance in microAlgos
    */
   async getAccountBalance(account: string): Promise<BN> {
      const data = await this.getAccountInfo(account);
      return toBN(data.amount.toString());
   }

   /**
    * @returns {BN} - current transaction/network fee in microAlgos
    */
   async getCurrentTransactionFee(): Promise<BN> {
      const suggestedParams = (await this.getTransactionParams()) as algosdk.SuggestedParams;
      return toBN(suggestedParams.fee);
   }

   /**
    * @param {string} source
    * @param {string} destination
    * @param {BN} amountInMicroAlgos
    * @param {BN|undefined} feeInMicroAlgos - automatically set if undefined (ALGO uses fee per byte)
    * @param {string} note
    * @param {BN|undefined} maxFeeInMicroAlgos - fee per byte
    * @returns {Object} - ALGO transaction object
    */
   async preparePaymentTransaction(
      source: string,
      destination: string,
      amountInMicroAlgos: BN,
      feeInMicroAlgos?: BN,
      note?: string,
      maxFeeInMicroAlgos?: BN
   ): Promise<algosdk.Transaction> {
      const suggestedParams = (await this.getTransactionParams()) as algosdk.SuggestedParams;
      const preparedNote = note ? new Uint8Array(Buffer.from(note, "utf8")) : undefined;
      if (feeInMicroAlgos) {
         suggestedParams.fee = toNumber(feeInMicroAlgos);
         suggestedParams.flatFee = true;
      }
      if (maxFeeInMicroAlgos && suggestedParams.fee > toNumber(maxFeeInMicroAlgos)) {
         throw Error(`Transaction is not prepared: maxFee ${maxFeeInMicroAlgos} is higher than fee ${suggestedParams.fee}`);
      }
      // TODO amountInMicroAlgos should be in BN
      const tr = algosdk.makePaymentTxnWithSuggestedParams(source, destination, toNumber(amountInMicroAlgos), undefined, preparedNote, suggestedParams);
      return tr;
   }

   /**
    * @param {Object} transaction
    * @param {string} privateKey
    * @returns {string}
    */
   async signTransaction(transaction: algosdk.Transaction, privateKey: string): Promise<string> {
      const secretKey = stringToUint8Arr(privateKey);
      const tx = uint8ArrToString(transaction.signTxn(secretKey));
      return tx;
   }

   /**
    * @param {string} signedTx
    * @returns {Object} - containing transaction id tx_id and optional result
    */
   async submitTransaction(signedTx: string): Promise<ISubmitTransactionResponse> {
      const signedTxArr = stringToUint8Arr(signedTx);
      const res = await this.algodClient.post("/v2/transactions", signedTxArr);
      algo_ensure_data(res);
      return res.data;
   }

   ///////////////////////////////////////////////////////////////////////////////////////
   // HELPER OR CLIENT SPECIFIC FUNCTIONS ////////////////////////////////////////////////
   ///////////////////////////////////////////////////////////////////////////////////////

   /**
    * @param {string} account
    * @returns {Object}
    */
   async getAccountInfo(account: string): Promise<algosdk.modelsv2.Account> {
      const accountResp = await this.algodClient.get(`/v2/accounts/${account}`);
      algo_ensure_data(accountResp);
      return accountResp.data;
   }

   /**
    * Retrieves transactions parameters
    */
   async getTransactionParams(): Promise<algosdk.SuggestedParams> {
      const resp = await this.algodClient.get(`/v2/transactions/params`);
      algo_ensure_data(resp);
      //https://github.com/algorand/js-algorand-sdk/blob/develop/src/client/v2/algod/suggestedParams.ts
      return {
         flatFee: false,
         fee: resp.data.fee,
         firstRound: resp.data["last-round"],
         lastRound: resp.data["last-round"] + 1000,
         genesisID: resp.data["genesis-id"],
         genesisHash: resp.data["genesis-hash"],
      } as algosdk.SuggestedParams;
   }

   /**
    * Returns transaction object when transaction is accepted to the ledger
    * @param {string} txHash
    * @returns {Object} - containing transaction id tx_id and optional result
    */
   /* istanbul ignore next */
   async waitForTransaction(txHash: string): Promise<ISubmitTransactionResponse> {
      await sleepMs(ALGO_LEDGER_CLOSE_TIME_MS);
      const txResp = await this.algodClient.get(`/v2/transactions/pending/${txHash}`);
      algo_ensure_data(txResp);
      const data = txResp.data;
      if (data !== undefined) {
         if (data["confirmed-round"] !== null && data["confirmed-round"] > 0) {
            // Transaction completed
            return { txId: txHash };
         }
         if (data["confirmed-round"] !== null && data["confirmed-round"] > 0) {
            // Transaction completed
            return { txId: txHash };
         }
         if (data["pool-error"] != null && data["pool-error"].length > 0) {
            // If there was a pool error, then the transaction has been rejected!
            throw new Error(`Transaction Rejected pool error${data["pool-error"]}`);
         }
      }
      return this.waitForTransaction(txHash);
   }
}
