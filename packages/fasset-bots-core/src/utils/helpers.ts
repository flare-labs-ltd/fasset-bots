import BN from "bn.js";
import crypto from "crypto";
import util from "util";
import Web3 from "web3";
import { logger } from "./logger";

export type BNish = BN | number | string;

export type Nullable<T> = T | null | undefined;

export type Dict<T> = { [key: string]: T };

export type Modify<T, R> = Omit<T, keyof R> & R;

export type RequireFields<T, K extends keyof T> = T & Required<Pick<T, K>>;

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

export const MAX_UINT256 = toBN(1).shln(256).subn(1);

export const DEFAULT_TIMEOUT = 15000;
export const DEFAULT_RETRIES = 3;
export const DEFAULT_RETRY_DELAY_MS = 2000;

export const TRANSACTION_FEE_FACTOR = 1.4;

/**
 * Asynchronously wait `ms` milliseconds.
 */
export function sleep(ms: number) {
    return new Promise<void>((resolve) => setTimeout(() => resolve(), ms));
}

/**
 * Asynchronously wait `delayMS` milliseconds, but stop immediately if `stopCondition()` becomes true.
 */
export async function sleepUntil(delayMS: number, stopCondition: () => boolean, pollMS: number = 100) {
    const start = systemTimestampMS();
    while (systemTimestampMS() - start < delayMS) {
        if (stopCondition()) break;
        await sleep(pollMS);
    }
}

/**
 * Return system time as timestamp (seconds since 1.1.1970).
 */
export function systemTimestamp() {
    return Math.floor(Date.now() / 1000);
}

/**
 * Return system time as millisecond timestamp (milliseconds since 1.1.1970).
 */
export function systemTimestampMS() {
    return Date.now();
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
    if (x != null) return x as any;
    throw new Error(errorMessage ?? "Value is null or undefined");
}

/**
 * Check if value is non-null and throw otherwise.
 */
export function assertNotNull<T>(x: T, errorMessage?: string): asserts x is NonNullable<T> {
    if (x == null) {
        throw new Error(errorMessage ?? "Value is null or undefined");
    }
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
        if (!/^\d+(\.\d+)?$/.test(x)) throw new Error("toStringExp: invalid number format");
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

/**
 * Return the minimum of two or more BN values.
 */
export function minBN(first: BN, ...rest: BN[]) {
    let result = first;
    for (const x of rest) {
        if (x.lt(result)) result = x;
    }
    return result;
}

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

// Error handling

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
export type ErrorFilter = string | { new(...args: any[]): Error };

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

export function isTransactionRevert(error: any): boolean {
    return typeof error?.message === "string" && /\breverted\b/i.test(error.message);
}

export function cleanupRevertMessage(error: any): string {
    const message = String(error?.message ?? "");
    const regex = /(?:execution reverted:|reverted with reason string) +(.*?)(?:\n|$)/;
    return regex.exec(message)?.[1] ?? message;
}

export function expectErrors(error: any, expectedErrors: ErrorFilter[]): undefined {
    if (errorIncluded(error, expectedErrors)) return;
    throw error; // unexpected error
}

export function messageForExpectedError(error: any, expectedErrors: ErrorFilter[]): unknown {
    return errorIncluded(error, expectedErrors) ? error.message : error;
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
    maxRetries = DEFAULT_RETRIES,
    retryDelayMs = DEFAULT_RETRY_DELAY_MS
): Promise<Awaited<ReturnType<T>>> {
    return await retryCall(fn.name, () => fn(...args), maxRetries, retryDelayMs);
}

/**
 * Retries a function n number of times before giving up
 */
export async function retryCall<R>(name: string, call: () => Promise<R>, maxRetries = DEFAULT_RETRIES, retryDelayMs = DEFAULT_RETRY_DELAY_MS): Promise<R> {
    for (let retry = 1; /* stopping condition in catch */; retry++) {
        try {
            const result = await call();
            return result;
        } catch (error) {
            if (retry === maxRetries) {
                console.log(`All ${maxRetries} retry attempts exhausted for function ${name}: ${error}`);
                logger.error(`All ${maxRetries} retry attempts exhausted for function ${name}`, error);
                throw error;
            }
            logger.info(`Retry ${retry} failed for function ${name}. Retrying after delay of ${retry * retryDelayMs} ms.`);
            await sleep(retry * retryDelayMs);
        }
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

/**
 * Unprefixes a string with 0x if it is prefixed.
 */
export function unPrefix0x(str: string) {
    return str.replace(/^0x/i, "");
}

/**
 * Prefixes a string with 0x if it is not already prefixed.
 */
export function prefix0x(str: string) {
    return str.match(/^0x/i) ? str : "0x" + str;
}

export function compareHexValues(hex1: string, hex2: string) {
    const upperHex1 = hex1.toUpperCase();
    const upperHex2 = hex2.toUpperCase();
    return upperHex1 === upperHex2;
}

export function firstValue<K, V>(map: Map<K, V>): V | undefined {
    for (const v of map.values()) {
        return v;
    }
}

export function randomChoice<K>(array: K[]): K | undefined {
    if (array.length === 0) return undefined;
    return array[Math.floor(Math.random() * array.length)];
}

export function* enumerate<T>(array: T[]): Iterable<[T, number]> {
    for (let i = 0; i < array.length; i++) {
        yield [array[i], i];
    }
}

export function isEnumValue<T extends string>(enumCls: { [key: string]: T }, value: string): value is T {
    return Object.values(enumCls).includes(value as any);
}

/**
 * Replaces all occurences of `${VAR}` in strings in the object `obj` with the contents of the environment variable `VAR`.
 * @param obj the object (NOTE: it will be modified inplace)
 * @returns inplace modified `obj`
 */
export function substituteEnvVars(obj: unknown) {
    if (typeof obj === "string") {
        return obj.replace(/\$\{(\w+)\}/, (m, varname) => requireEnv(varname));
    } else if (Array.isArray(obj)) {
        for (let i = 0; i < obj.length; i++) {
            obj[i] = substituteEnvVars(obj[i]);
        }
    } else if (typeof obj === "object" && obj !== null) {
        for (const [k, v] of Object.entries(obj)) {
            (obj as any)[k] = substituteEnvVars(v);
        }
    }
    return obj;
}
