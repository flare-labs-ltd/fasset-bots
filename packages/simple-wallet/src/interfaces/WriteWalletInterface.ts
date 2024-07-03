import { ChainType } from "../utils/constants";
import BN from "bn.js";

export interface WriteWalletInterface {
   chainType: ChainType;

   createWallet(): ICreateWalletResponse;
   createWalletFromMnemonic(mnemonic: string): ICreateWalletResponse;

   getAccountBalance(account: string): Promise<BN>;
   getCurrentTransactionFee(params: FeeParams): Promise<BN>;

   preparePaymentTransaction(
      source: string,
      destination: string,
      amount: BN | null,
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
      amount: BN | null,
      fee?: BN,
      note?: string,
      maxFee?: BN,
      sequence?: number
   ): Promise<any>;

   deleteAccount(
      source: string,
      privateKey: string,
      destination: string,
      fee?: BN,
      note?: string,
      maxFee?: BN,
      sequence?: number
   ): Promise<any>;

   getReplacedOrTransactionHash(transactionHash: string): Promise<string>;
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

export interface XRPFeeParams {
   isPayment: boolean;
}

export interface UTXOFeeParams {
   source: string;
   destination: string;
   amount: BN | null;
}

export type FeeParams = XRPFeeParams | UTXOFeeParams;

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

export type SchemaUpdate = "none" | "safe" | "full" | "recreate";

export interface BaseWalletConfig {
   url: string;
   inTestnet?: boolean;
   apiTokenKey?: string;
   username?: string; // probably never used
   password?: string; // probably never used
   rateLimitOptions?: RateLimitOptions;
   stuckTransactionOptions?: StuckTransaction;
}

export type RippleWalletConfig = BaseWalletConfig;
export type BitcoinWalletConfig = BaseWalletConfig;
export type LitecoinWalletConfig = BaseWalletConfig;
export type DogecoinWalletConfig = BaseWalletConfig;
export type AlgoWalletConfig = BaseWalletConfig;
