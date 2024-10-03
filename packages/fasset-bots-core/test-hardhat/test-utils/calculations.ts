import BN from "bn.js"
import { toBNExp, MAX_BIPS } from "../../src/utils"

export function assetPriceForAgentCr(
    crBips: BN,
    totalMintedUBA: BN,
    collateralWei: BN,
    assetFtsoPrice: BN,
    assetFtsoDecimals: number,
    assetTokenDecimals: number,
    collateralFtsoDecimals: number,
    collateralTokenDecimals: number
): BN {
    const expPlus = assetTokenDecimals + collateralFtsoDecimals
    const expMinus = assetFtsoDecimals + collateralTokenDecimals
    return toBNExp(10, expPlus)
        .mul(assetFtsoPrice)
        .mul(crBips)
        .mul(totalMintedUBA)
        .divn(MAX_BIPS)
        .div(toBNExp(10, expMinus))
        .div(collateralWei)
}