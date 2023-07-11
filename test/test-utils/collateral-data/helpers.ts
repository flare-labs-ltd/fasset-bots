import { AMGSettings, AMG_TOKENWEI_PRICE_SCALE } from "../../../src/fasset/Conversions";
import { BNish, toBN } from "../../../src/utils/helpers";

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

export function convertAmgToUBA(settings: AMGSettings, valueAMG: BNish) {
    return toBN(valueAMG).mul(toBN(settings.assetMintingGranularityUBA));
}

export function convertUBAToAmg(settings: AMGSettings, valueUBA: BNish) {
    return toBN(valueUBA).div(toBN(settings.assetMintingGranularityUBA));
}

export function convertTokenWeiToAMG(valueNATWei: BNish, amgToTokenWeiPrice: BNish) {
    return toBN(valueNATWei).mul(AMG_TOKENWEI_PRICE_SCALE).div(toBN(amgToTokenWeiPrice));
}

export function convertTokenWeiToUBA(settings: AMGSettings, valueWei: BNish, amgToNATWeiPrice: BNish) {
    return convertAmgToUBA(settings, convertTokenWeiToAMG(valueWei, amgToNATWeiPrice));
}