import BN from "bn.js";
import { BNish, exp10, toBN, toBNExp } from "../utils/helpers";
import { AssetManagerSettings } from "./AssetManagerTypes";

export const AMG_TOKENWEI_PRICE_SCALE = toBNExp(1, 9);

export interface AMGSettings {
    assetMintingDecimals: BNish;
    assetMintingGranularityUBA: BNish;
}

export function amgToTokenWeiPrice(
    settings: AMGSettings,
    tokenDecimals: BNish,
    tokenUSD: BNish,
    tokenFtsoDecimals: BNish,
    assetUSD: BNish,
    assetFtsoDecimals: BNish
): BN {
    // the scale by which token/asset price is divided
    const tokenScale = exp10(toBN(tokenDecimals).add(toBN(tokenFtsoDecimals)));
    const assetScale = exp10(toBN(settings.assetMintingDecimals).add(toBN(assetFtsoDecimals)));
    return toBN(assetUSD).mul(tokenScale).mul(AMG_TOKENWEI_PRICE_SCALE).div(toBN(tokenUSD).mul(assetScale));
}

export function roundUBAToAmg(settings: AMGSettings, valueUBA: BNish) {
    return toBN(valueUBA).sub(toBN(valueUBA).mod(toBN(settings.assetMintingGranularityUBA)));
}

export function convertUBAToAmg(settings: AMGSettings, valueUBA: BNish): BN {
    return toBN(valueUBA).div(toBN(settings.assetMintingGranularityUBA));
}

export function convertAmgToTokenWei(valueAMG: BNish, amgToTokenWeiPrice: BNish): BN {
    return toBN(valueAMG).mul(toBN(amgToTokenWeiPrice)).div(AMG_TOKENWEI_PRICE_SCALE);
}

export function convertUBAToTokenWei(settings: AMGSettings, valueUBA: BNish, amgToNATWeiPrice: BNish): BN {
    return convertAmgToTokenWei(convertUBAToAmg(settings, valueUBA), amgToNATWeiPrice);
}

// Lot conversions

export function lotSize(settings: AssetManagerSettings): BN {
    return toBN(settings.lotSizeAMG).mul(toBN(settings.assetMintingGranularityUBA));
}
