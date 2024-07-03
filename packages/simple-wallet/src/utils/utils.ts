import safeStringify from "fast-safe-stringify";
import {
   BTC_LEDGER_CLOSE_TIME_MS,
   BTC_MAINNET,
   BTC_TESTNET,
   ChainType,
   DOGE_LEDGER_CLOSE_TIME_MS,
   DOGE_MAINNET,
   DOGE_TESTNET,
   LOCK_ADDRESS_FACTOR,
   LTC_LEDGER_CLOSE_TIME_MS,
   LTC_MAINNET,
   LTC_TESTNET,
   XRP_LEDGER_CLOSE_TIME_MS,
} from "./constants";
import { StuckTransaction } from "../interfaces/WriteWalletInterface";

function MccError(error: any) {
   try {
      return new Error(safeStringify(error, undefined, 2, { depthLimit: 2, edgesLimit: 3 }));
   } catch (thisError) {
      /* istanbul ignore next */
      return new Error(`MCC stringify error ${thisError}`);
   }
}

export async function sleepMs(ms: number) {
   await new Promise<void>((resolve) => setTimeout(() => resolve(), ms));
}

export function wallet_utxo_ensure_data(data: any) {
   if (data.statusText !== "OK") {
      throw MccError(data);
   }
}

export function algo_ensure_data(data: any) {
   const error_codes = [400, 401, 404, 500, 503];
   if (error_codes.includes(data.status)) {
      throw MccError(data);
   }
}

export function xrp_ensure_data(data: any) {
   if (data.result.status === "error") {
      if (data.result.error === "txnNotFound") {
         throw MccError(data.status);
      }
      if (data.result.error === "lgrNotFound") {
         throw MccError(data.status);
      }
      throw MccError(data);
   }
}

export function bytesToHex(a: Iterable<number> | ArrayLike<number>): string {
   return Array.from(a, (byteValue) => {
      const hex = byteValue.toString(16).toUpperCase();
      return hex.length > 1 ? hex : "0" + hex;
   }).join("");
}

export function uint8ArrToString(a: Uint8Array): string {
   return Buffer.from(a).toString("base64");
}

export function stringToUint8Arr(data: string): Uint8Array {
   return new Uint8Array(Buffer.from(data, "base64"));
}

export function unPrefix0x(tx: string) {
   return tx.startsWith("0x") ? tx.slice(2) : tx;
}

export function prefix0x(tx: string) {
   return tx.startsWith("0x") ? tx : "0x" + tx;
}

export function isValidBytes32Hex(address: string) {
   return /^(0x|0X)?[0-9a-fA-F]{64}$/i.test(address);
}

export function isValidHexString(maybeHexString: string) {
   return /^(0x|0X)?[0-9a-fA-F]*$/i.test(maybeHexString);
}

export function requireEnv(name: string) {
   const value = process.env[name];
   if (value != null) return value;
   throw new Error(`Environment value ${name} not defined`);
}

export function excludeNullFields<T>(dict: Record<string, T>): Record<string, NonNullable<T>> {
   const result: Record<string, NonNullable<T>> = {};
   for (const [key, val] of Object.entries(dict)) {
      if (val == null) continue;
      result[key] = val;
   }
   return result;
}

export function getTimeLockForAddress(chainType: ChainType, blockOffset: number, maxRetries: number) {
   return getAvgBlockTime(chainType) * blockOffset * LOCK_ADDRESS_FACTOR * (maxRetries + 1);
}

export function getAvgBlockTime(chainType: ChainType): number {
   switch (chainType) {
      case ChainType.BTC:
      case ChainType.testBTC:
         return BTC_LEDGER_CLOSE_TIME_MS;
      case ChainType.DOGE:
      case ChainType.testDOGE:
         return DOGE_LEDGER_CLOSE_TIME_MS;
      case ChainType.LTC:
      case ChainType.testLTC:
         return LTC_LEDGER_CLOSE_TIME_MS;
      case ChainType.XRP:
      case ChainType.testXRP:
         return XRP_LEDGER_CLOSE_TIME_MS;
      default:
         throw new Error(`Constants not defined for chain type ${chainType}`);
   }
}

export function stuckTransactionConstants(chainType: ChainType): StuckTransaction {
   switch (chainType) {
      case ChainType.BTC:
      case ChainType.testBTC:
         return {
            blockOffset: 1,
            retries: 2,
            feeIncrease: 3,
         };
      case ChainType.LTC:
      case ChainType.testLTC:
         return {
            blockOffset: 3,
            retries: 1,
            feeIncrease: 2,
         };
      case ChainType.DOGE:
      case ChainType.testDOGE:
         return {
            blockOffset: 3,
            retries: 1,
            feeIncrease: 2,
         };
      case ChainType.XRP:
      case ChainType.testXRP:
         return {
            blockOffset: 10,
            retries: 1,
            feeIncrease: 2,
            lastResortFee: 1e6,
         };
      default:
         throw new Error(`Constants not defined for chain type ${chainType}`);
   }
}

export function getCurrentNetwork(chainType: ChainType) {
   switch (chainType) {
      case ChainType.BTC:
         return BTC_MAINNET;
      case ChainType.testBTC:
         return BTC_TESTNET;
      case ChainType.DOGE:
         return DOGE_MAINNET;
      case ChainType.testDOGE:
         return DOGE_TESTNET;
      case ChainType.LTC:
         return LTC_MAINNET;
      case ChainType.testLTC:
         return LTC_TESTNET;
      default:
         throw new Error(`Unsupported chain type ${chainType}`);
   }
}
