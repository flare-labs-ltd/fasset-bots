import { assetPriceForAgentCr } from "../../calculations"
import type { AddressLike } from "ethers"
import type { IERC20Metadata } from "../../../types"
import type { Contracts } from "./interfaces/contracts"


// obtains the f-assets's price that results in agent having collateral ratio of crBips
export async function getCollateralPriceForAgentCr(
    contracts: Contracts,
    agentAddress: AddressLike,
    crBips: number,
    collateralToken: IERC20Metadata,
    collateralSymbol: string,
    fAssetSymbol: string,
    collateralKind: "vault" | "pool",
): Promise<bigint> {
    const agentInfo = await contracts.assetManager.getAgentInfo(agentAddress)
    const totalMintedUBA = agentInfo.mintedUBA + agentInfo.redeemingUBA + agentInfo.reservedUBA
    const collateralWei = collateralKind === "vault" ? agentInfo.totalVaultCollateralWei : agentInfo.totalPoolCollateralNATWei
    const { 0: collateralFtsoPrice, 2: collateralFtsoDecimals } = await contracts.priceReader.getPrice(collateralSymbol)
    const { 2: fAssetFtsoDecimals } = await contracts.priceReader.getPrice(fAssetSymbol)
    return assetPriceForAgentCr(
        BigInt(crBips),
        totalMintedUBA,
        collateralWei,
        collateralFtsoPrice,
        collateralFtsoDecimals,
        await collateralToken.decimals(),
        fAssetFtsoDecimals,
        await contracts.fAsset.decimals()
    )
}