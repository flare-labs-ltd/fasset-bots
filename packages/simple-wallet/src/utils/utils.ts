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
   XRP_LEDGER_CLOSE_TIME_MS,
} from "./constants";
import { StuckTransaction } from "../interfaces/WalletTransactionInterface";
import BN from "bn.js";

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
            blockOffset: 2,
            feeIncrease: 1.5,
            executionBlockOffset: 1,
         };
      case ChainType.DOGE:
      case ChainType.testDOGE:
         return {
            blockOffset: 4,
            feeIncrease: 2,
            executionBlockOffset: 2
         };
      case ChainType.XRP:
      case ChainType.testXRP:
         return {
            blockOffset: 6,
            feeIncrease: 2,
            executionBlockOffset: 2
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
      default:
         throw new Error(`Unsupported chain type ${chainType}`);
   }
}

//TODO add for timestamp
export function shouldExecuteTransaction(executeUntilBlock: number | null, latestBlock: number, executionBlockOffset: number): boolean {
   if (!executeUntilBlock || (executeUntilBlock && (executeUntilBlock - latestBlock) >= executionBlockOffset)) {
      return true;
   }
   return false;
}


export function checkIfFeeTooHigh(fee: BN, maxFee?: BN | null): boolean {
   if (maxFee && fee.gt(maxFee)) {
      return true;
   }
   return false;
}
