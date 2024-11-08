import BN from "bn.js";
import util from "node:util";
import { toBN, formatBN } from "../../src/utils";

export function isBNLike(value: any) {
    return BN.isBN(value) || (typeof value === 'string' && /^\d+$/.test(value));
}

/**
 * Some Web3 results are union of array and struct so console.log prints them as array.
 * This function converts it to struct nad also formats values.
 */
export function deepFormat(value: any): any {
    if (isBNLike(value)) {
        return formatBN(value);
    } else if (Array.isArray(value)) {
        const structEntries = Object.entries(value).filter(([key, val]) => typeof key !== 'number' && !/^\d+$/.test(key));
        if (structEntries.length > 0 && structEntries.length >= value.length) {
            const formattedEntries = structEntries.map(([key, val]) => [key, deepFormat(val)]);
            return Object.fromEntries(formattedEntries);
        } else {
            return value.map(v => deepFormat(v));
        }
    } else if (typeof value === 'object' && value != null) {
        const formattedEntries = Object.entries(value).map(([key, val]) => [key, deepFormat(val)]);
        return Object.fromEntries(formattedEntries);
    } else {
        return value;
    }
}

/**
 * Print `name = value` pairs for a dict of format `{name: value, name: value, ...}`
 */
export function trace(items: Record<string, any>) {
    for (const [key, value] of Object.entries(items)) {
        const serialize = typeof value === 'object' && [Array, Object].includes(value.constructor);
        const valueS = serialize ? JSON.stringify(deepFormat(value)) : deepFormat(value);
        console.log(`${key} = ${valueS}`);
    }
}

/**
 * Improve console.log display by pretty-printing BN end expanding objects.
 * @param inspectDepth the depth objects in console.log will be expanded
 */
export function improveConsoleLog(inspectDepth: number = 10) {
    const BN = toBN(0).constructor;
    BN.prototype[util.inspect.custom] = function () {
        return `BN(${this.toString(10)})`;
    };
    util.inspect.defaultOptions.depth = inspectDepth;
}
