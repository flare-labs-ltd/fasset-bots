import { ChainType } from "../utils/constants";
import BN from "bn.js";

export interface WriteWalletRpcInterface {
   chainType: ChainType;

   createWallet(): ICreateWalletResponse;
   createWalletFromMnemonic(mnemonic: string): ICreateWalletResponse;

   getAccountBalance(account: string): Promise<BN>;
   getCurrentTransactionFee(): Promise<BN>;

   preparePaymentTransaction(
      source: string,
      destination: string,
      amount: BN,
      fee?: BN,
      note?: string,
      maxFee?: BN,
      sequence?: number
   ): Promise<any>;
   signTransaction(transaction: any, privateKey: string): Promise<string>;
   submitTransaction(signedTx: string): Promise<any>;
   executeLockedSignedTransactionAndWait(
      source: string,
      privateKey: string,
      destination: string,
      amount: BN,
      fee?: BN,
      note?: string,
      maxFee?: BN,
      sequence?: number
   ): Promise<any>;
}

export interface ICreateWalletResponse {
   address: string;
   mnemonic: string;
   privateKey: string;
   publicKey?: string;
}

export interface ISubmitTransactionResponse {
   txId: string;
   result?: string;
}

export interface UTXO {
   txid: string;
   outputIndex: number;
   scriptPubKey: string;
   satoshis: number;
   confirmations: number;
}

export interface RateLimitOptions {
   maxRequests?: number;
   perMilliseconds?: number;
   maxRPS?: number;
   timeoutMs?: number;
   retries?: number;
}

export interface StuckTransaction {
   blockOffset?: number; // How many block to wait for transaction to be validated
   retries?: number; // How many times should transaction retry to successfully submit
   feeIncrease?: number; // Factor to increase fee in resubmitting process
   lastResortFee?: number; // fee to use when all retries fail
}

export interface BaseRpcConfig {
   url: string;
   inTestnet?: boolean;
   apiTokenKey?: string;
   username?: string; // probably never used
   password?: string; // probably never used
   rateLimitOptions?: RateLimitOptions;
   stuckTransactionOptions?: StuckTransaction;
}

export type RippleRpcConfig = BaseRpcConfig;
export type BitcoinRpcConfig = BaseRpcConfig;
export type LitecoinRpcConfig = BaseRpcConfig;
export type DogecoinRpcConfig = BaseRpcConfig;
export type AlgoRpcConfig = BaseRpcConfig;
