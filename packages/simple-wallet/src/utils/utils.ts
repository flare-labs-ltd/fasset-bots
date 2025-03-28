import {
   ChainType,
   DEFAULT_FEE_INCREASE,
   DROPS_PER_XRP} from "./constants";
import { StuckTransaction } from "../interfaces/IWalletTransaction";
import BN, {  } from "bn.js";
import { toBN } from "./bnutils";
import { getConfirmedAfter, getDefaultBlockTimeInSeconds } from "../chain-clients/utxo/UTXOUtils";
import { UTXOWalletImplementation } from "../chain-clients/implementations/UTXOWalletImplementation";
import { XrpWalletImplementation } from "../chain-clients/implementations/XrpWalletImplementation";
import crypto from "crypto";
import { MempoolUTXO } from "../interfaces/IBlockchainAPI";

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

export function stuckTransactionConstants(chainType: ChainType): Required<Pick<StuckTransaction, 'blockOffset' | 'feeIncrease' | 'executionBlockOffset' | 'enoughConfirmations'>>{
   switch (chainType) {
      case ChainType.BTC:
      case ChainType.testBTC:
         return {
            blockOffset: 12,//accepted in next x blocks
            feeIncrease: DEFAULT_FEE_INCREASE,
            executionBlockOffset: 1,//do not submit if "one block" time left
            enoughConfirmations: getConfirmedAfter(chainType)
         };
      case ChainType.DOGE:
      case ChainType.testDOGE:
         return {
            blockOffset: 40,//accepted in next x blocks
            feeIncrease: DEFAULT_FEE_INCREASE,
            executionBlockOffset: 3,//do not submit if "three blocks" time left
            enoughConfirmations: getConfirmedAfter(chainType)
         };
      case ChainType.XRP:
      case ChainType.testXRP:
         return {
            blockOffset: 200,// cca 1.5 min
            feeIncrease: DEFAULT_FEE_INCREASE,
            executionBlockOffset: 2,
            enoughConfirmations: 1
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
   let now: BN  = toBN(getCurrentTimestampInSeconds());
   if (client instanceof UTXOWalletImplementation) {
      const medianTime = client.feeService.getLatestMedianTime();
      if (medianTime) {
         now = medianTime;
     } else {
         return blockRestrictionMet ? false : true; // check only block restriction if median cannot be determined
     }
   }
   if (executeUntilTimestamp && executeUntilTimestamp.toString().length > 11) { // legacy: there used to be dates stored in db.
       executeUntilTimestamp = toBN(convertToTimestamp(executeUntilTimestamp.toString()));
   }
   const timeRestrictionMet = executeUntilTimestamp && now && (now.add(toBN(client.executionBlockOffset * getDefaultBlockTimeInSeconds(client.chainType))).gte(executeUntilTimestamp));

   if (executeUntilBlock && !executeUntilTimestamp && blockRestrictionMet) {
      return false;
   } else if (!executeUntilBlock && executeUntilTimestamp && timeRestrictionMet) {
      return false;
   } else if (executeUntilBlock && executeUntilTimestamp && blockRestrictionMet && !now) {
      return false;
   }   else if (blockRestrictionMet && timeRestrictionMet) {
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

export function createMonitoringId(prefix: string | ChainType): string {
   return `${prefix}-${crypto.randomBytes(8).toString("hex")}`;
}

export function requireDefined<T>(x: T, errorMessage?: string): NonNullable<T> {
   if (x != null) return x as any;
   throw new Error(errorMessage ?? "Value is null or undefined");
}

export function updateErrorWithFullStackTrace(error: unknown, skipDepth: number = 0): Error {
   if (error instanceof Error) {
      error.stack = fullStackTrace(error, skipDepth + 1);
      return error;
   }
   return new Error(`Unknown error: ${error}`);
}

export function fullStackTrace(error: Error, skipDepth: number = 0): string {
   const originalStack = error.stack ?? "Missing original error stack";
   const stackError = new Error("just for stack");
   // always skip 1 line for message, 1 for this method
   const extraStackLines = (stackError.stack ?? "").split("\n").slice(skipDepth + 2);
   const filteredStackLines = extraStackLines.filter(l => !originalStack.includes(l));
   return originalStack.trimEnd() + "\n" + filteredStackLines.join("\n");
}

export function consoleLogListMempoolUTXOs(utxos: MempoolUTXO[][] | null) {
   if (!utxos || utxos.length === 0) {
      console.log("No UTXOs available.");
      return;
   }

   console.log("Listing UTXOs:");
   utxos.forEach((utxoGroup, groupIndex) => {
      console.log(`\nUTXO Group #${groupIndex + 1}:`);

      utxoGroup.forEach((utxo, utxoIndex) => {
         console.log(`  UTXO ${utxoIndex + 1}:`);
         console.log(`    - Transaction Hash: ${utxo.transactionHash}`);
         console.log(`    - Position: ${utxo.position}`);
         console.log(`    - Value: ${utxo.value.toString()}`);
         console.log(`    - Script: ${utxo.script}`);
         console.log(`    - Confirmed: ${utxo.confirmed}`);
      });
   });
}