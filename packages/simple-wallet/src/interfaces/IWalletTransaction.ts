import { EntityManager } from "@mikro-orm/core";
import { TransactionStatus } from "../entity/transaction";
import { ChainType } from "../utils/constants";
import BN from "bn.js";

export interface WalletAccountGenerationInterface {
   chainType: ChainType;

   createWallet(): ICreateWalletResponse;
   createWalletFromMnemonic(mnemonic: string): ICreateWalletResponse;
}

export interface WriteWalletInterface extends WalletAccountGenerationInterface {

   getAccountBalance(account: string, otherAddresses?: string[]): Promise<BN>;
   getCurrentTransactionFee(params: FeeParams): Promise<BN>;

   createPaymentTransaction(
      source: string,
      privateKey: string,
      destination: string,
      amount: BN | null,
      fee?: BN,
      note?: string,
      maxFee?: BN,
      executeUntilBlock?: number,
      executeUntilTimestamp?: BN,
   ): Promise<number>;

   createDeleteAccountTransaction(
      source: string,
      privateKey: string,
      destination: string,
      fee?: BN,
      note?: string,
      maxFee?: BN,
   ): Promise<number>;

   getTransactionInfo(dbId: number): Promise<TransactionInfo>;

   startMonitoringTransactionProgress(): Promise<void>;
   stopMonitoring(): Promise<void>;
   isMonitoring(): Promise<boolean>;
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
   note?: string;
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
   enoughConfirmations? : number; // number of confirmations to be declared successful
}

export type SchemaUpdate = "none" | "safe" | "full" | "recreate";

export interface WalletApi {
   url: string;
   apiTokenKey?: string;
}

export interface BaseWalletConfig {
   url: string;
   inTestnet?: boolean;
   apiTokenKey?: string;
   rateLimitOptions?: RateLimitOptions;
   stuckTransactionOptions?: StuckTransaction;
   enoughConfirmations?: number,
   feeServiceConfig?: FeeServiceConfig;
   feeDecileIndex?: number, // the decile from which to use the fee if there's a fee-service running (eg 8 is 8-th decile)
   em: EntityManager;
   walletKeys: IWalletKeys;
   fallbackAPIs?: WalletApi[]
}

export type RippleWalletConfig = BaseWalletConfig;
export type BitcoinWalletConfig = BaseWalletConfig;
export type DogecoinWalletConfig = BaseWalletConfig;

export interface SignedObject {
   txBlob: string;
   txHash: string;
   txSize?: number;
}

export interface TransactionInfo {
   dbId: number;
   transactionHash: string | null;
   status: TransactionStatus;
   replacedByDdId: number | null,
   replacedByHash: string | null,
   replacedByStatus: TransactionStatus | null,
}

export interface IWalletKeys {
   getKey(address: string): Promise<string | undefined>;
   addKey(address: string, privateKey: string): Promise<void>;
}

export interface FeeServiceConfig {
   indexerUrl: string;
   rateLimitOptions?: RateLimitOptions;
   sleepTimeMs: number;
   numberOfBlocksInHistory: number;
}

export interface BlockStats {
   blockHeight: number;
   blockTime: number;
   timeSincePreviousBlock: number;
   averageFeePerKB: BN;
   decilesFeePerKB: BN[];
}