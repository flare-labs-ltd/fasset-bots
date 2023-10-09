import BN from "bn.js";
import util from "util";
import Web3 from "web3";
import { logger } from "./logger";
import crypto from "crypto";

export type BNish = BN | number | string;

export type Nullable<T> = T | null | undefined;

export type Dict<T> = { [key: string]: T };

export type Modify<T, R> = Omit<T, keyof R> & R;

export const BN_ZERO = new BN(0);
export const BN_ONE: BN = Web3.utils.toBN(1);
export const BN_TEN: BN = Web3.utils.toBN(10);
export const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
export const ZERO_BYTES32 = "0x0000000000000000000000000000000000000000000000000000000000000000";

export const MAX_BIPS = 10_000;

export const MINUTES = 60;
export const HOURS = 60 * MINUTES;
export const DAYS = 24 * HOURS;
export const WEEKS = 7 * DAYS;

export const CCB_LIQUIDATION_PREVENTION_FACTOR = 1.2;
export const NEGATIVE_FREE_UNDERLYING_BALANCE_PREVENTION_FACTOR = 1.2;
export const STABLE_COIN_LOW_BALANCE = toBNExp(1000, 18);
export const NATIVE_LOW_BALANCE = toBNExp(1000, 18);

export const QUERY_WINDOW_SECONDS = 86400;

export const MAX_UINT256 = toBN(1).shln(256).subn(1);

export const DEFAULT_TIMEOUT = 15000;
export const DEFAULT_RETRIES = 3;

export const XRP_ACTIVATE_BALANCE = toBNExp(10, 6);

export const MINUS_CHAR = "-";

/**
 * Asynchronously wait `ms` milliseconds.
 */
export function sleep(ms: number) {
    return new Promise<void>((resolve) => setTimeout(() => resolve(), ms));
}

/**
 * Return system time as timestamp (seconds since 1.1.1970).
 */
export function systemTimestamp() {
    return Math.round(new Date().getTime() / 1000);
}

/**
 * Check if value is non-null.
 * Useful in array.filter, to return array of non-nullable types.
 */
export function isNotNull<T>(x: T): x is NonNullable<T> {
    return x != null;
}

/**
 * Check if value is non-null and throw otherwise.
 * Returns guaranteed non-null value.
 */
export function requireNotNull<T>(x: T, errorMessage?: string): NonNullable<T> {
    if (x != null) return x as NonNullable<T>;
    throw new Error(errorMessage ?? "Value is null or undefined");
}

/**
 * Helper wrapper to convert number to BN
 * @param x number expressed in any reasonable type
 * @returns same number as BN
 */
export function toBN(x: BN | number | string): BN {
    if (BN.isBN(x)) return x;
    return Web3.utils.toBN(x);
}

/**
 * Helper wrapper to convert BN, BigNumber or plain string to number. May lose precision, so use it for tests only.
 * @param x number expressed in any reasonable type
 * @returns same number as Number
 */
export function toNumber(x: BN | number | string) {
    if (typeof x === "number") return x;
    return Number(x);
}

// return String(Math.round(x * 10^exponent)), but sets places below float precision to zero instead of some random digits
export function toStringExp(x: number | string, exponent: number): string {
    let xStr: string;
    if (typeof x === "number") {
        const significantDecimals = x !== 0 ? Math.max(0, 14 - Math.floor(Math.log10(x))) : 0;
        const decimals = Math.min(exponent, significantDecimals);
        xStr = x.toFixed(decimals);
    } else {
        xStr = x;
    }
    const dot = xStr.indexOf(".");
    const mantissa = dot >= 0 ? xStr.slice(0, dot) + xStr.slice(dot + 1) : xStr;
    const precision = dot >= 0 ? xStr.length - (dot + 1) : 0;
    if (precision === exponent) return mantissa;
    /* istanbul ignore if */
    if (exponent < precision) throw new Error("toStringExp: loss of precision");
    const zeros = Array.from({ length: exponent - precision }, () => "0").join(""); // trailing zeros
    return mantissa + zeros;
}

// return BN(x * 10^exponent)
export function toBNExp(x: number | string, exponent: number): BN {
    return toBN(toStringExp(x, exponent));
}

/**
 * Convert value to hex with 0x prefix and optional padding.
 */
export function toHex(x: string | number | BN, padToBytes?: number) {
    if (padToBytes && padToBytes > 0) {
        return Web3.utils.leftPad(Web3.utils.toHex(x), padToBytes * 2);
    }
    return Web3.utils.toHex(x);
}

/**
 * Sum all values in an Array or Iterable of BNs.
 */
export function sumBN<T>(list: Iterable<T>, elementValue: (x: T) => BN): BN {
    return reduce(list, BN_ZERO, (a, x) => a.add(elementValue(x)));
}

/**
 * Convert object to subclass with type check.
 */
/* istanbul ignore next */
export function checkedCast<S, T extends S>(obj: S, cls: new (...args: any[]) => T): T {
    if (obj instanceof cls) return obj;
    throw new Error(`object not instance of ${cls.name}`);
}

/**
 * Get value of key `key` for map. If it doesn't exists, create new value, add it to the map and return it.
 */
export function getOrCreate<K, V, R extends V>(map: Map<K, V>, key: K, create: (key: K) => R): V {
    if (map.has(key)) {
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        return map.get(key)!;
    }
    const value = create(key);
    map.set(key, value);
    return value;
}

/**
 * Get value of key `key` for map. If it doesn't exists, create new value, add it to the map and return it.
 */
export async function getOrCreateAsync<K, V, R extends V>(map: Map<K, V>, key: K, create: (key: K) => Promise<R>): Promise<V> {
    if (map.has(key)) {
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        return map.get(key)!;
    }
    const value = await create(key);
    map.set(key, value);
    return value;
}

/**
 * Like Array.reduce, but for any Iterable.
 */
export function reduce<T, R>(list: Iterable<T>, initialValue: R, operation: (a: R, x: T) => R) {
    let result = initialValue;
    for (const x of list) {
        result = operation(result, x);
    }
    return result;
}

/**
 * Return the maximum of two or more BN values.
 */
export function maxBN(first: BN, ...rest: BN[]) {
    let result = first;
    for (const x of rest) {
        if (x.gt(result)) result = x;
    }
    return result;
}

export class CommandLineError extends Error {}

// toplevel async function runner for node.js
/* istanbul ignore next */
export function toplevelRun(main: () => Promise<void>) {
    main()
        .catch((error) => {
            if (error instanceof CommandLineError) {
                console.error(`Error: ${error.message}`);
            } else {
                console.error(error);
            }
            process.exit(1);
        })
        .finally(() => {
            process.exit(0);
        });
}

// Error handling

export function fail(messageOrError: string | Error): never {
    if (typeof messageOrError === "string") {
        throw new Error(messageOrError);
    }
    throw messageOrError;
}

export function requireEnv(name: string) {
    const value = process.env[name];
    if (value != null) return value;
    throw new Error(`Environment value ${name} not defined`);
}

// return text, converting "${ENV_VAR}" argument to `process.env[ENV_VAR]`
/* istanbul ignore next */
export function autoReadEnvVar(text: string) {
    const m = text.match(/^\s*\$\{(\w+)\}\s*$/);
    return m ? requireEnv(m[1]) : text;
}

export function filterStackTrace(error: any) {
    const stack = String(error.stack || error);
    let lines = stack.split("\n");
    lines = lines.filter((l) => !l.startsWith("    at") || /\.(sol|ts):/.test(l));
    return lines.join("\n");
}

export function reportError(error: any) {
    console.error(filterStackTrace(error));
}

// either (part of) error message or an error constructor
export type ErrorFilter = string | { new (...args: any[]): Error };

export function errorIncluded(error: any, expectedErrors: ErrorFilter[]) {
    const message = String(error?.message ?? "");
    for (const expectedErr of expectedErrors) {
        if (typeof expectedErr === "string") {
            if (message.includes(expectedErr)) return true;
        } else {
            if (error instanceof expectedErr) return true;
        }
    }
    return false;
}

export function expectErrors(error: any, expectedErrors: ErrorFilter[]): undefined {
    if (errorIncluded(error, expectedErrors)) return;
    throw error; // unexpected error
}

export function toBIPS(x: number | string) {
    if (typeof x === "string" && x.endsWith("%")) {
        return toBNExp(x.slice(0, x.length - 1), 2); // x is in percent, only multiply by 100
    } else {
        return toBNExp(x, 4);
    }
}

// Calculate 10 ** n as BN.
export function exp10(n: BNish) {
    return BN_TEN.pow(toBN(n));
}

/**
 * Retries a function n number of times before giving up
 */
export async function retry<T extends (...arg0: any[]) => any>(
    fn: T,
    args: Parameters<T>,
    maxTry: number,
    currRetry: number = 0
): Promise<Awaited<ReturnType<T>>> {
    const delay = 2000;
    try {
        const result = await fn(...args);
        return result;
    } catch (e) {
        logger.info(`Retry ${currRetry} failed for function ${fn.name}.`);
        if (currRetry >= maxTry) {
            console.log(`All ${maxTry} retry attempts exhausted`);
            logger.error(`All ${maxTry} retry attempts exhausted for function ${fn.name}: ${e}`);
            throw e;
        }
        currRetry++;
        logger.info(`Retrying ${fn.name} ${currRetry} times after delaying  ${currRetry * delay} ms.`);
        await sleep(currRetry * delay);
        return retry(fn, args, maxTry, currRetry);
    }
}

export function generateRandomHexString(numBytes: number) {
    const randomString = crypto.randomBytes(numBytes).toString("hex");
    return randomString;
}

export function createSha256Hash(data: string) {
    return crypto.createHash("sha256").update(data).digest("hex");
}

/**
 * Wrap an async method so that it cannot be called twice in parallel.
 */
export function preventReentrancy(method: () => Promise<void>) {
    let inMethod = false;
    return async () => {
        if (inMethod) return;
        inMethod = true;
        try {
            await method();
        } finally {
            inMethod = false;
        }
    };
}

/**
 * Improve console.log display by pretty-printing BN end expanding objects.
 * @param inspectDepth the depth objects in console.log will be expanded
 */
export function improveConsoleLog(inspectDepth: number = 10) {
    const BN = toBN(0).constructor;
    /* istanbul ignore next */
    BN.prototype[util.inspect.custom] = function () {
        return `BN(${this.toString(10)})`;
    };
    util.inspect.defaultOptions.depth = inspectDepth;
}

/**
 * Replaces the substring of `str` from `start` to `start + length` with `replacement`.
 */
export function replaceStringRange(str: string, start: number, length: number, replacement: string) {
    return str.slice(0, start) + replacement + str.slice(start + length);
}
