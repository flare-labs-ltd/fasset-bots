import BN from "bn.js";

/**
 * Converts each consecutive sequence of spaces, tabs and newlines to a single space.
 * Useful for converting a long template, split over several lines, to a single line.
 * To be used as tag.
 */
export function squashSpace(strings: TemplateStringsArray, ...args: any[]) {
    const normStrings = strings.map(s => s.replace(/\s+/g, ' '));
    return String.raw({ raw: normStrings }, ...args);
}

export function isBigNumber(x: any): x is BN | string {
    return BN.isBN(x) || (typeof x === "string" && /^\d+$/.test(x));
}

export function formatArgs(args: any) {
    if (!args) return null;
    const result: any = {};
    for (const [key, value] of Object.entries(args)) {
        if (Number.isNaN(parseInt(key)) && key != "__length__") {
            result[key] = formatArg(value);
        }
    }
    return JSON.stringify(result);
}

function formatArg(value: unknown): string {
    if (isBigNumber(value)) {
        return formatBN(value);
    } else if (Array.isArray(value)) {
        return `[${value.map((v) => formatArg(v)).join(", ")}]`;
    } else if (typeof value === "object" && value?.constructor === Object) {
        return `{ ${Object.entries(value)
            .map(([k, v]) => `${k}: ${formatArg(v)}`)
            .join(", ")} }`;
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
function groupIntegerDigits(x: string) {
    let startp = x.indexOf(".");
    if (startp < 0) startp = x.length;
    const endp = x[0] === "-" ? 1 : 0;
    for (let p = startp - 3; p > endp; p -= 3) {
        x = x.slice(0, p) + "_" + x.slice(p);
        x;
    }
    return x;
}
