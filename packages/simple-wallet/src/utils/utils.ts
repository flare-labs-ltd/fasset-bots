import {
   BTC_DEFAULT_FEE_PER_KB,
   BTC_LEDGER_CLOSE_TIME_MS,
   BTC_MAINNET,
   BTC_TESTNET,
   ChainType, DOGE_DEFAULT_FEE_PER_KB,
   DOGE_LEDGER_CLOSE_TIME_MS,
   DOGE_MAINNET,
   DOGE_TESTNET,
   LOCK_ADDRESS_FACTOR,
   XRP_LEDGER_CLOSE_TIME_MS,
} from "./constants";
import { StuckTransaction } from "../interfaces/IWalletTransaction";
import BN from "bn.js";
import { toBN } from "./bnutils";
import { getDefaultBlockTimeInSeconds } from "../chain-clients/utxo/UTXOUtils";
import { UTXOWalletImplementation } from "../chain-clients/utxo/UTXOWalletImplementation";
import { XrpWalletImplementation } from "../chain-clients/implementations/XrpWalletImplementation";
import crypto from "crypto";

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

export function stuckTransactionConstants(chainType: ChainType): StuckTransaction {
   switch (chainType) {
      case ChainType.BTC:
      case ChainType.testBTC:
         return {
            blockOffset: 6,//accepted in next x blocks
            feeIncrease: 2,
            executionBlockOffset: 1,//submit if "one block time" left
            enoughConfirmations: 2
         };
      case ChainType.DOGE:
      case ChainType.testDOGE:
         return {
            blockOffset: 8,//accepted in next x blocks
            feeIncrease: 2,
            executionBlockOffset: 3,//submit if "one block time" left
            enoughConfirmations: 10
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

// as in attestaion
export function getConfirmedAfter(chainType: ChainType): number {
   switch (chainType) {
      case ChainType.BTC:
      case ChainType.testBTC:
         return 6;
      case ChainType.DOGE:
      case ChainType.testDOGE:
         return 60;
      default:
         throw new Error(`Unsupported chain type ${chainType}`);
   }
}

export function getDefaultFeePerKB(chainType: ChainType): BN {
   switch (chainType) {
      case ChainType.BTC:
      case ChainType.testBTC:
         return toBN(BTC_DEFAULT_FEE_PER_KB); // 0.0001 BTC ; in library 0.001 BTC https://github.com/bitpay/bitcore/blob/d09a9a827ea7c921e7f1e556ace37ea834a40422/packages/bitcore-lib/lib/transaction/transaction.js#L83
      case ChainType.DOGE:
      case ChainType.testDOGE:
         return toBN(DOGE_DEFAULT_FEE_PER_KB); // 1 DOGE //https://github.com/bitpay/bitcore/blob/d09a9a827ea7c921e7f1e556ace37ea834a40422/packages/bitcore-lib-doge/lib/transaction/transaction.js#L87
      default:
         throw new Error(`Unsupported chain type ${chainType}`);
   }
}
export async function checkIfShouldStillSubmit(client: UTXOWalletImplementation | XrpWalletImplementation, currentBlockHeight: number, executeUntilBlock?: number, executeUntilTimestamp?: BN): Promise<boolean> {
   const blockRestriction = !!executeUntilBlock && (currentBlockHeight - executeUntilBlock >= client.executionBlockOffset);
   // It probably should be following, but due to inconsistant blocktime on btc, we use currentTime
   //const timeRestriction = executeUntilTimestamp && currentBlockHeight.timestamp - executeUntilTimestamp > client.executionBlockOffset * getDefaultBlockTime(client.chainType)
   const now = toBN(getCurrentTimestampInSeconds());
   if (executeUntilTimestamp && executeUntilTimestamp.toString().length > 11) { //legacy TODO-test
       executeUntilTimestamp = toBN(convertToTimestamp(executeUntilTimestamp.toString()));
   }
   const timeRestriction = !!executeUntilTimestamp && (now.sub(executeUntilTimestamp).gten(client.executionBlockOffset * getDefaultBlockTimeInSeconds(client.chainType))); //TODO-urska (is this good estimate

   if (client.chainType === ChainType.testBTC || client.chainType === ChainType.BTC || client.chainType === ChainType.testDOGE || client.chainType === ChainType.DOGE) {
       if (blockRestriction) {
           return false;
       }
   } else {
       if (executeUntilBlock && !executeUntilTimestamp && blockRestriction) {
           return false;
       } else if (!executeUntilBlock && executeUntilTimestamp && timeRestriction) {
           return false;
       } else if (blockRestriction && timeRestriction) {
           return false;
       }
   }
   return true;
}


export function encryptText(password: string, text: string, useScrypt: boolean): string {
    const initVector = crypto.randomBytes(16);
    const passwordHash = createPasswordHash(useScrypt, password, initVector);
    const cipher = crypto.createCipheriv("aes-256-gcm", passwordHash, initVector);
    const encBuf = cipher.update(text, "utf-8");
    // mark scrypt based encryption with '@' to keep compatibility (sha256 hashes are only used in some testnet beta bots)
    // '@' does not appear in base64 encoding, so this is not ambigous
    const prefix = useScrypt ? "@" : "";
    return prefix + Buffer.concat([initVector, encBuf]).toString("base64");
}

export function decryptText(password: string, encText: string): string {
    const encIvBuf = Buffer.from(encText.replace(/^@/, ""), "base64");
    const initVector = encIvBuf.subarray(0, 16);
    const encBuf = encIvBuf.subarray(16);
    const useScrypt = encText.startsWith("@");  // '@' marks password hashing with scrypt
    const passwordHash = createPasswordHash(useScrypt, password, initVector);
    const cipher = crypto.createDecipheriv("aes-256-gcm", passwordHash, initVector);
    return cipher.update(encBuf).toString("utf-8");
}

function createPasswordHash(useScrypt: boolean, password: string, salt: Buffer) {
    if (useScrypt) {
        const N = 2 ** 15, r = 8, p = 1;    // provides ~100ms hash time
        const scryptOptions: crypto.ScryptOptions = { N, r, p, maxmem: 256 * N * r };
        return crypto.scryptSync(Buffer.from(password, "ascii"), salt, 32, scryptOptions);
    } else {
        return crypto.createHash("sha256").update(password, "ascii").digest();
    }
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
