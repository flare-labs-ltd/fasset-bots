import BN from "bn.js";
import { BN_ZERO, exp10, toBN, toBNExp } from "../../src/utils/helpers";
import { AssetManagerSettings } from "../../src/fasset/AssetManagerTypes";

export class AsyncLock {
    locked: boolean = false;

    async run(func: () => Promise<void>) {
        if (this.locked) return false;
        this.locked = true;
        try {
            await func();
        } finally {
            this.locked = false;
        }
        return true;
    }
}

export class Statistics {
    min?: number;
    max?: number;
    count: number = 0;
    sum: number = 0;

    get average() {
        return this.count > 0 ? this.sum / this.count : undefined;
    }

    add(x: BN | number) {
        if (typeof x !== "number") x = x.toNumber();
        if (this.min == undefined || this.min > x) this.min = x;
        if (this.max == undefined || this.max < x) this.max = x;
        this.count += 1;
        this.sum += x;
    }

    toString(decimals = 2) {
        const min = this.min?.toFixed(decimals) ?? "---";
        const max = this.max?.toFixed(decimals) ?? "---";
        const avg = this.average?.toFixed(decimals) ?? "---";
        return `n: ${this.count}  min: ${min}  avg: ${avg}  max: ${max}`;
    }
}

// start is inclusive, end is exclusive
export function randomInt(end: number): number;
export function randomInt(start: number, end: number): number;
export function randomInt(startOrEnd: number, endOpt?: number): number {
    const [start, end] = endOpt !== undefined ? [startOrEnd, endOpt] : [0, startOrEnd];
    return Math.floor(start + Math.random() * (end - start));
}

// start is inclusive, end is exclusive
export function randomNum(end: number): number;
export function randomNum(start: number, end: number): number;
export function randomNum(startOrEnd: number, endOpt?: number): number {
    const [start, end] = endOpt !== undefined ? [startOrEnd, endOpt] : [0, startOrEnd];
    return start + Math.random() * (end - start);
}

// start is inclusive, end is exclusive
export function randomBN(end: BN): BN;
export function randomBN(start: BN, end: BN): BN;
export function randomBN(startOrEnd: BN, endOpt?: BN): BN {
    const [start, end] = endOpt !== undefined ? [startOrEnd, endOpt] : [BN_ZERO, startOrEnd];
    const random = Math.floor(Math.random() * Number.MAX_SAFE_INTEGER);
    return start.add(end.sub(start).mul(toBN(random)).div(toBN(Number.MAX_SAFE_INTEGER)));
}

// random must return random number on interval [0, 1)
export function randomIntDist(start: number, end: number, random: () => number): number {
    return Math.floor(start + random() * (end - start));
}

// retrun random in [0, 1) with probability density falling linearly from 1 to 0
export function linearFallingRandom() {
    return Math.abs(Math.random() + Math.random() - 1);
}

// (unfair) coin flip - returns true with probability p
export function coinFlip(p: number = 0.5) {
    return Math.random() < p;
}

export function randomChoice<T>(choices: readonly T[], avoid?: T): T {
    if (choices.length === 0) throw new Error("Random choice from empty array.");
    if (avoid === undefined) {
        return choices[randomInt(choices.length)];
    } else {
        const ind = randomInt(choices.length - 1);
        if (choices[ind] !== avoid) return choices[ind];
        if (choices.length === 1) throw new Error("No avoidable choices.");
        return choices[choices.length - 1];
    }
}

export function weightedRandomChoice<T>(choices: readonly (readonly [T, number])[]): T {
    if (choices.length === 0) throw new Error("Random choice from empty array.");
    let total = 0;
    for (const [choice, weight] of choices) total += weight;
    const rnd = Math.random() * total;
    let cumulative = 0;
    for (const [choice, weight] of choices) {
        cumulative += weight;
        if (rnd < cumulative) return choice;
    }
    return choices[choices.length - 1][0]; // shouldn't arrive here, but just in case...
}

export function randomShuffle(array: any[]) {
    const length = array.length;
    for (let i = 0; i < length - 1; i++) {
        const j = randomInt(i, length);
        [array[i], array[j]] = [array[j], array[i]];
    }
}

export function randomShuffled<T>(array: T[] | Iterable<T>): T[] {
    const copy = Array.from(array);
    randomShuffle(copy);
    return copy;
}

export interface InclusionIterable<T> extends Iterable<T> {
    indexOf(x: T): number;
    includes(x: T): boolean;
}

export function range(start: number, end: number | null, step: number = 1, inclusive?: "inclusive"): InclusionIterable<number> {
    let endN = end ?? (step > 0 ? Number.POSITIVE_INFINITY : Number.NEGATIVE_INFINITY);
    if (inclusive === "inclusive") endN += step;
    return {
        [Symbol.iterator]: function* () {
            if (step > 0) {
                for (let i = start; i < endN; i += step) yield i;
            } else {
                for (let i = start; i > endN; i += step) yield i;
            }
        },
        indexOf(x: number) {
            if (step > 0) {
                if (x < start || x >= endN) return -1;
            } else {
                if (x > start || x <= endN) return -1;
            }
            const ind = (x - start) / step;
            return Math.floor(ind) === ind ? ind : -1; // is ind whole number?
        },
        includes(x: number) {
            return this.indexOf(x) >= 0;
        },
        toString() {
            const incl = Number.isFinite(endN) && inclusive === "inclusive";
            return `range(${start}, ${incl ? endN - step + " (inclusive)" : endN}, ${step})`;
        },
    } as InclusionIterable<number>;
}

export function parseRange(s: string) {
    if (/^(\d+(,\d+)*)?$/.test(s)) {
        return s != "" ? s.split(",").map(Number) : [];
    } else {
        const m = s.match(/^(\d+)(?:,(\d+))?,?...,?(\d+)?$/);
        if (m) return range(Number(m[1]), m[3] ? Number(m[3]) : null, m[2] ? Number(m[2]) - Number(m[1]) : 1, "inclusive");
        throw new Error("Invalid range value");
    }
}

// current time in seconds (not an integer)
export function currentRealTime() {
    return new Date().getTime() / 1000;
}

// nicely formated elapsed time since startRealTime
export function elapsedTime(startRealTime: number) {
    return (currentRealTime() - startRealTime).toFixed(3);
}

// truffle makes results of functions returning struct as an array with extra string keys
// this method converts it to JS dict
export function truffleResultAsDict(result: any): any {
    if (!Array.isArray(result)) {
        return result; // not an array
    }
    const keys = Object.keys(result);
    const stringKeys = keys.filter((k) => !/^\d+/.test(k));
    if (stringKeys.length === 0) {
        // result is really an array
        return result.map((v) => truffleResultAsDict(v));
    } else {
        // result is bot array and dict as
        const res: any = {};
        for (const key of stringKeys) res[key] = truffleResultAsDict((result as any)[key]);
        return res;
    }
}

export function truffleResultAsJson(result: any, indent?: string | number): any {
    return stringifyJson(truffleResultAsDict(result));
}

// JSON.stringify with correct BN handling
export function stringifyJson(data: any, indent?: string | number) {
    return JSON.stringify(data, jsonBNserializer, indent);
}

export function jsonBNserializer(this: any, key: any, serializedValue: any) {
    const value = this[key];
    return BN.isBN(value) ? value.toString(10) : serializedValue;
}

/**
 * Run an async task on every element of an array. Start tasks for all elements immediately (in parallel) and complete when all are completed.
 * @param array array of arguments
 * @param func the task to run for every element of the array
 */
export async function foreachAsyncParallel<T>(array: T[], func: (x: T, index: number) => Promise<void>) {
    await Promise.all(array.map(func));
}

/**
 * Run an async task on every element of an array. Start tasks for every element when the previous completes (serial). Complete when all are completed.
 * @param array array of arguments
 * @param func the task to run for every element of the array
 */
export async function foreachAsyncSerial<T>(array: T[], func: (x: T, index: number) => Promise<void>) {
    for (let i = 0; i < array.length; i++) {
        await func(array[i], i);
    }
}

const envConverters = {
    number: (s: string) => Number(s),
    string: (s: string) => s,
    boolean: (s: string): boolean => {
        if (s === "true") return true;
        if (s === "false") return false;
        throw new Error("Invalid boolean value");
    },
    "number[]": (s: string) => (s != "" ? s.split(",").map(Number) : []),
    "string[]": (s: string) => s.split(","),
    "boolean[]": (s: string) => s.split(",").map((p) => envConverters["boolean"](p)),
    range: (s: string) => parseRange(s),
    json: (s: string) => JSON.parse(s),
} as const;
type EnvConverterType = keyof typeof envConverters;
type EnvConverterResult<T extends EnvConverterType> = ReturnType<(typeof envConverters)[T]>;

/**
 * Get an environment variable and convert it to some type.
 * @param name environment variable name
 * @param type conversion type, one of "string" | "number" | "boolean" | "number[]" | "string[]" | "boolean[] | range" | "json"
 * @param defaultValue the value to return if the environment variable does not exist
 */
export function getEnv<T extends EnvConverterType, D extends EnvConverterResult<T> | null>(name: string, type: T, defaultValue: D): EnvConverterResult<T> | D {
    const value = process.env[name];
    if (value == null) return defaultValue;
    return envConverters[type](value) as EnvConverterResult<T>;
}

// convert NAT amount to base units (wei)
export function toWei(amount: number | string) {
    return toBNExp(amount, 18);
}

/**
 * Like `a.muln(b)`, but while muln actually works with non-integer numbers, it is very imprecise,
 * i.e. `BN(1e30).muln(1e-20) = BN(0)` and `BN(1e10).muln(0.15) = BN(1476511897)`.
 * This function gives as exact results as possible.
 */
export function mulDecimal(a: BN, b: number) {
    if (Math.round(b) === b && Math.abs(b) < 1e16) {
        return a.mul(toBN(b));
    }
    const exp = 15 - Math.ceil(Math.log10(b));
    const bm = Math.round(b * 10 ** exp);
    const m = a.mul(toBN(bm));
    return exp >= 0 ? m.div(exp10(exp)) : m.mul(exp10(-exp));
}

export function getLotSize(settings: AssetManagerSettings): BN {
    return toBN(settings.lotSizeAMG).mul(toBN(settings.assetMintingGranularityUBA));
}

/**
 * Format large number in more readable format, using 'fixed-exponential' format, with 'e+18' suffix for very large numbers.
 * (This makes them easy to visually detect bigger/smaller numbers.)
 */
export function formatBN(x: BN | string | number) {
    const xs = x.toString();
    if (xs.length >= 18) {
        const dec = Math.max(0, 22 - xs.length);
        const xm = (Number(xs) / 1e18).toFixed(dec);
        return groupIntegerDigits(xm) + "e+18";
    } else {
        return groupIntegerDigits(xs);
    }
}

/**
 * Put '_' characters between 3-digit groups in integer part of a number.
 */
export function groupIntegerDigits(x: string) {
    let startp = x.indexOf(".");
    if (startp < 0) startp = x.length;
    const endp = x[0] === "-" ? 1 : 0;
    for (let p = startp - 3; p > endp; p -= 3) {
        x = x.slice(0, p) + "_" + x.slice(p);
        x;
    }
    return x;
}
