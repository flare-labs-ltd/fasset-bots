import BN from 'bn.js';
import { groupIntegerDigits } from '../../test-hardhat/test-utils/fuzzing-utils';
import { BaseEvent } from './events/common';

function formatArg(value: unknown): string {
    if (isBigNumber(value)) {
        return formatBN(value);
    } else if (Array.isArray(value)) {
        return `[${value.map(v => formatArg(v)).join(', ')}]`;
    } else if (typeof value === 'object' && value?.constructor === Object) {
        return `{ ${Object.entries(value).map(([k, v]) => `${k}: ${formatArg(v)}`).join(', ')} }`;
    } else {
        return '' + value;
    }
}

function isBigNumber(x: any) {
    return BN.isBN(x) || (typeof x === 'string' && /^\d+$/.test(x));
}

function formatBN(x: any) {
    const xs = x.toString();
    if (xs.length >= 18) {
        const dec = Math.max(0, 22 - xs.length);
        const xm = (Number(xs) / 1e18).toFixed(dec);
        return groupIntegerDigits(xm) + 'e+18';
    } else {
        return groupIntegerDigits(xs);
    }
}

export function formatArgs(args: any) {
    const result: any = {};
    for (const [key, value] of Object.entries(args)) {
        if (Number.isNaN(parseInt(key)) && key != '__length__') {
            result[key] = formatArg(value);
        }
    }
    return JSON.stringify(result);
}
