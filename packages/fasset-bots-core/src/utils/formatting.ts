import BN from "bn.js";

/**
 * Converts each consecutive sequence of spaces, tabs and newlines to a single space.
 * Useful for converting a long template, split over several lines, to a single line.
 * To be used as tag.
 */
export function squashSpace(strings: TemplateStringsArray, ...args: any[]) {
    const normStrings = strings.map(s => s.replace(/\s+/g, " "));
    return String.raw({ raw: normStrings }, ...args);
}

/**
 * Fix indentation in a multiline template string by deleting the smallest indent after line 1.
 * This allows template string to be nicely indented in code and when printed.
 */
export function stripIndent(strings: TemplateStringsArray, ...args: any[]): string;
export function stripIndent(text: string): string;
export function stripIndent(strings: string | TemplateStringsArray, ...args: any[]) {
    function countIndentSpaces(s: string) {
        let i = 0;
        while (i < s.length && s[i] === " ") i++;
        return i;
    }
    const text = typeof strings === "string" ? strings : String.raw({ raw: strings }, ...args);
    const lines = text.split("\n");
    const indentsInLinesAfterFirst = lines.slice(1).map(countIndentSpaces);
    const minIndent = Math.min(...indentsInLinesAfterFirst);
    const indentStr = " ".repeat(minIndent);
    const strippedLines = lines.map((line, i) => i > 0 && line.startsWith(indentStr) ? line.slice(minIndent) : line);
    return strippedLines.join("\n");
}

export function isBigNumber(x: any): x is BN | string {
    return BN.isBN(x) || (typeof x === "string" && /^\d+$/.test(x));
}

export function isNumericKey(k: string | number) {
    return typeof k === "number" || (typeof k === "string" && /^\d+$/.test(k));
}

export function formatArgs(args: unknown) {
    return formatArg(args, true);
}

function formatArg(value: unknown, skipArrayKeys: boolean = false): string {
    if (isBigNumber(value)) {
        return formatBN(value);
    } else if (Array.isArray(value)) {
        const entriesFmt = value.map((v) => formatArg(v)).join(", ");
        return `[${entriesFmt}]`;
    } else if (typeof value === "object" && value?.constructor === Object) {
        const entriesFmt = Object.entries(value)
            .filter(([k, v]) => !skipArrayKeys || (!isNumericKey(k) && k !== "__length__"))
            .map(([k, v]) => `${k}: ${formatArg(v)}`)
            .join(", ");
        return `{ ${entriesFmt} }`;
    } else {
        return "" + value;
    }
}

/**
 * Format large number in more readable format, using 'fixed-exponential' format, with 'e+18' suffix for very large numbers.
 * (This makes them easy to visually detect bigger/smaller numbers.)
 */
export function formatBN(x: BN | string | number) {
    const xs = x.toString();
    if (xs.length >= 18) {
        const dec = Math.max(0, 22 - xs.length);
        const xm = (Number(xs) / 1000000000000000000).toFixed(dec);
        return groupIntegerDigits(xm) + "e+18";
    } else {
        return groupIntegerDigits(xs);
    }
}

/**
 * Put '_' characters between 3-digit groups in integer part of a number.
 */
function groupIntegerDigits(x: string, seperator: string = "_") {
    let startp = x.indexOf(".");
    if (startp < 0) startp = x.length;
    const endp = x[0] === "-" ? 1 : 0;
    for (let p = startp - 3; p > endp; p -= 3) {
        x = x.slice(0, p) + seperator + x.slice(p);
    }
    return x;
}

export type FormattedString = string & { _formattedStringTypeTag: undefined };

export interface FormatSettings {
    decimals?: number;          // maximum decimals to display
    padRight?: boolean;         // if true, display decimals even if they are 0
    groupDigits?: boolean;      // group integer digits (thousands) with thousandSeparator or "_"
    groupSeparator?: string;    // default "_"
}

const BN_TEN = new BN(10);

export function formatFixed(value: BN, decimals: number, format: FormatSettings = {}): FormattedString {
    let displayDecimals = decimals;
    if (format.decimals != null && format.decimals < decimals) {
        displayDecimals = Math.max(format.decimals, 0);
        value = value.divRound(BN_TEN.pow(new BN(decimals - displayDecimals)));
    }
    if (displayDecimals === 0) {
        return value.toString(10) as FormattedString;
    }
    const mantissa = value.toString(10).padStart(displayDecimals + 1, "0");
    const dotPos = mantissa.length - displayDecimals;
    let result = mantissa.slice(0, dotPos) + "." + mantissa.slice(dotPos);
    if (!format.padRight) {
        result = result.replace(/\.?0+$/, "");
    }
    if (format.groupDigits) {
        result = groupIntegerDigits(result, format.groupSeparator ?? "_");
    }
    return result as FormattedString;
}

export function formatBips(value: BN, format?: FormatSettings): FormattedString {
    return `${formatFixed(value, 2, format)}%` as FormattedString;
}

export function formatTimestamp(value: BN): FormattedString {
    return new Date(Number(value) * 1000).toISOString() as FormattedString;
}
