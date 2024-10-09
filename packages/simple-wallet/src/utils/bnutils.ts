import BN from "bn.js";
import Web3Utils from "web3-utils";

/**
 * Helper wrapper to convert number to BN
 * @param x number expressed in any reasonable type
 * @returns same number as BN
 */
export function toBN(x: BN | number | string): BN {
   if (BN.isBN(x)) return x;
   return Web3Utils.toBN(x);
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
function toStringExp(x: number | string, exponent: number): string {
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
