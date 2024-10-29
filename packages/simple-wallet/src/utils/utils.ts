import {
   ChainType,
   DEFAULT_FEE_INCREASE, DEFAULT_RATE_LIMIT_OPTIONS,
   DROPS_PER_XRP,
} from "./constants";
import { RateLimitOptions, StuckTransaction } from "../interfaces/IWalletTransaction";
import BN from "bn.js";
import { toBN } from "./bnutils";
import { getDefaultBlockTimeInSeconds } from "../chain-clients/utxo/UTXOUtils";
import { UTXOWalletImplementation } from "../chain-clients/implementations/UTXOWalletImplementation";
import { XrpWalletImplementation } from "../chain-clients/implementations/XrpWalletImplementation";
import axios, { AxiosInstance, AxiosRequestConfig } from "axios";
import axiosRateLimit from "../axios-rate-limiter/axios-rate-limit";
import { logger } from "./logger";
import { errorMessage } from "./axios-utils";

export async function sleepMs(ms: number) {
   await new Promise<void>((resolve) => setTimeout(() => resolve(), ms));
}

export function bytesToHex(a: Iterable<number> | ArrayLike<number>): string {
   return Array.from(a, (byteValue) => {
      const hex = byteValue.toString(16).toUpperCase();
      return hex.length > 1 ? hex : "0" + hex;
   }).join("");
}

export function getRandomInt(min: number, max: number): number {
   return Math.floor(Math.random() * (max - min)) + min;
}

export function unPrefix0x(tx: string) {
   return tx.startsWith("0x") ? tx.slice(2) : tx;
}

export function prefix0x(tx: string) {
   return tx.startsWith("0x") ? tx : "0x" + tx;
}

export function isValidHexString(maybeHexString: string) {
   return /^(0x|0X)?[0-9a-fA-F]*$/i.test(maybeHexString);
}

export function stuckTransactionConstants(chainType: ChainType): StuckTransaction {
   switch (chainType) {
      case ChainType.BTC:
      case ChainType.testBTC:
         return {
            blockOffset: 6,//accepted in next x blocks
            feeIncrease: DEFAULT_FEE_INCREASE,
            executionBlockOffset: 1,//do not submit if "one block" time left
            enoughConfirmations: 2
         };
      case ChainType.DOGE:
      case ChainType.testDOGE:
         return {
            blockOffset: 8,//accepted in next x blocks
            feeIncrease: DEFAULT_FEE_INCREASE,
            executionBlockOffset: 3,//do not submit if "three blocks" time left
            enoughConfirmations: 10
         };
      case ChainType.XRP:
      case ChainType.testXRP:
         return {
            blockOffset: 6,
            feeIncrease: DEFAULT_FEE_INCREASE,
            executionBlockOffset: 2
         };
      default:
         throw new Error(`Constants not defined for chain type ${chainType}`);
   }
}


export function checkIfFeeTooHigh(fee: BN, maxFee?: BN | null): boolean {
   if (maxFee && fee.gt(maxFee)) {
      return true;
   }
   return false;
}

export function checkIfShouldStillSubmit(client: UTXOWalletImplementation | XrpWalletImplementation, currentBlockHeight: number, executeUntilBlock?: number, executeUntilTimestamp?: BN): boolean {
   const blockRestrictionMet = !!executeUntilBlock && (currentBlockHeight + client.executionBlockOffset >= executeUntilBlock);
   // It probably should be following, but due to inconsistent block time on btc, we use currentTime
   //const timeRestriction = executeUntilTimestamp && currentBlockHeight.timestamp - executeUntilTimestamp > client.executionBlockOffset * getDefaultBlockTime(client.chainType)
   let now = toBN(getCurrentTimestampInSeconds());
   if (client instanceof UTXOWalletImplementation) {
      now = client.feeService.getLatestMedianTime() ?? now;
   }
   if (executeUntilTimestamp && executeUntilTimestamp.toString().length > 11) { // legacy: there used to be dates stored in db.
       executeUntilTimestamp = toBN(convertToTimestamp(executeUntilTimestamp.toString()));
   }
   const timeRestrictionMet = !!executeUntilTimestamp && (now.addn(client.executionBlockOffset * getDefaultBlockTimeInSeconds(client.chainType)).gte(executeUntilTimestamp));

   if (executeUntilBlock && !executeUntilTimestamp && blockRestrictionMet) {
      return false;
   } else if (!executeUntilBlock && executeUntilTimestamp && timeRestrictionMet) {
      return false;
   } else if (blockRestrictionMet && timeRestrictionMet) {
      return false;
   }
   return true;
}

export function getCurrentTimestampInSeconds() {
   return Math.floor(Date.now() / 1000);
}

export function getDateTimestampInSeconds(dateTime: string): number {
   const date = new Date(dateTime);
   if (isNaN(date.getTime())) {
     throw new Error("Invalid date format");
   }
   return Math.floor(date.getTime() / 1000);
 }

 // needed for legacy - at some point we change datetime to timestamp
 export function convertToTimestamp(dateTimeStr: string): string {
   const year = parseInt(dateTimeStr.slice(0, 4), 10);
   const month = parseInt(dateTimeStr.slice(4, 6), 10) - 1;
   const day = parseInt(dateTimeStr.slice(6, 8), 10);
   const hours = parseInt(dateTimeStr.slice(8, 10), 10);
   const minutes = parseInt(dateTimeStr.slice(10, 12), 10);
   const seconds = parseInt(dateTimeStr.slice(12, 14), 10);
   const date = new Date(Date.UTC(year, month, day, hours, minutes, seconds));

   return Math.floor(date.getTime() / 1000).toString();
 }

export function roundUpXrpToDrops(amount: number): number {
   return Math.ceil(amount * DROPS_PER_XRP) / DROPS_PER_XRP;
}


export function createAxiosClient(axiosConfig: AxiosRequestConfig, rateLimitOptions: RateLimitOptions | undefined) {
   const client = axios.create(axiosConfig);
   return axiosRateLimit(client, {
      ...DEFAULT_RATE_LIMIT_OPTIONS,
      ...rateLimitOptions,
   });
}

export async function tryWithClients<TResult>(clients: Record<string, AxiosInstance>, operation: (client: AxiosInstance) => Promise<TResult>, method: string) {
   for (const [index, url] of Object.keys(clients).entries()) {
      try {
         const result = await operation(clients[url]);
         return result;
      } catch (error) {
         if (index == Object.keys(clients).length - 1) {
            throw error;
         }
         logger.warn(`Client ${url} - ${method} failed with: ${errorMessage(error)}`);
      }
   }
   throw new Error(`All blockchain clients failed.`);
}

export function createMonitoringId(chainType: ChainType): string {
   return `${chainType}-${Math.random().toString(36).substring(2, 10)}`;
}