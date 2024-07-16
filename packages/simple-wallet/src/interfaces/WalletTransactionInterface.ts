import { TransactionStatus } from "../entity/transaction";
import { ChainType } from "../utils/constants";
import BN from "bn.js";

export interface WalletAccountGenerationInterface {
   chainType: ChainType;

   createWallet(): ICreateWalletResponse;
   createWalletFromMnemonic(mnemonic: string): ICreateWalletResponse;
}

export interface WriteWalletInterface extends WalletAccountGenerationInterface {

   getAccountBalance(account: string): Promise<BN>;
   getCurrentTransactionFee(params: FeeParams): Promise<BN>;

   createPaymentTransaction(
      source: string,
      privateKey: string,
      destination: string,
      amount: BN | null,
      fee?: BN,
      note?: string,
      maxFee?: BN,
      sequence?: number,
      executeUntilBlock?: number
   ): Promise<any>;

   createDeleteAccountTransaction(
      source: string,
      privateKey: string,
      destination: string,

      fee?: BN,
      note?: string,
      maxFee?: BN,
      sequence?: number
   ): Promise<any>;

   getTransactionInfo(dbId: number): Promise<TransactionInfo>;
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
   executionBlockOffset?: number; //
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
   walletSecret: string;
}

export type RippleWalletConfig = BaseWalletConfig;
export type BitcoinWalletConfig = BaseWalletConfig;
export type DogecoinWalletConfig = BaseWalletConfig;

export interface SignedObject {
   txBlob: string;
   txHash: string;
}

export interface TransactionInfo {
   dbId: number;
   replacedByDdId: number | null,
   transactionHash: string | null;
   status: TransactionStatus;
}