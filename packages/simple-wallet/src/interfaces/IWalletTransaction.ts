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
      destination: string,
      amount: BN | null,
      fee?: BN,
      note?: string,
      maxFee?: BN,
      executeUntilBlock?: number,
      executeUntilTimestamp?: BN,
      isFreeUnderlying?: boolean,
      feeSource?: string,
      maxPaymentForFeeSource?: BN,
      minFeePerKB?: BN
   ): Promise<number>;

   createDeleteAccountTransaction(
      source: string,
      destination: string,
      fee?: BN,
      note?: string,
      maxFee?: BN,
   ): Promise<number>;

   getTransactionInfo(dbId: number): Promise<TransactionInfo>;

   createMonitor(): Promise<ITransactionMonitor>;

   getMonitoringId(): string;
}

export interface ITransactionMonitor {
   getId(): string;
   isMonitoring(): boolean;
   startMonitoring(): Promise<boolean>;
   stopMonitoring(): Promise<void>;

   /**
    * Return running monitor id (possibly from another process) or null if there is no monitor running.
    * Can return false positives or negatives wrt to liveness, but only for some time; so after a few repetitions, it will return correct value.
    */
   runningMonitorId(): Promise<string | null>;
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
   feeSource?: string; // use this source to cover fees
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
   feeIncrease?: number; // Factor to increase fee in resubmitting process (should be integer)
   executionBlockOffset?: number; //
   enoughConfirmations? : number; // number of confirmations to be declared successful
   desiredChangeValue?: number; // value that change output should be (as close as possible) in base unit (DOGE, BTC)
}

export type SchemaUpdate = "none" | "safe" | "full" | "recreate";

export interface BaseWalletConfig extends WalletServiceConfigBase {
   stuckTransactionOptions?: StuckTransaction;
   em: EntityManager;
   walletKeys: IWalletKeys;
}

export interface WalletServiceConfigBase {
   urls: string[];
   inTestnet?: boolean;
   apiTokenKeys?: string[];
   rateLimitOptions?: RateLimitOptions;
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

export interface BlockStats {
   blockHeight: number;
   averageFeePerKB: BN;
   blockTime: BN;
}

export interface TransactionData {
   txId: number;
   source: string;
   destination: string;
   amount: BN;
   fee?: BN;
   feePerKB?: BN;
   useChange: boolean;
   note?: string;
   desiredChangeValue: BN;
}