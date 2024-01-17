import { swapOutputs, liquidationOutput, amgToTokenPrice, currentLiquidationFactorBIPS } from "../../calculations"
import { ubaToAmg } from "./utils"
import type { EcosystemConfig, AssetConfig, UnderlyingAsset, CollateralAsset } from "../fixtures/interface"

export class FixtureUtils {

  constructor(
    private assetConfig: AssetConfig,
    private ecosystemConfig: EcosystemConfig,
    private pathConfig: [string[], string[]]
  ) {}

  reservesFromAssets(assetA: string, assetB: string): [bigint, bigint] {
    if (assetA === "pool") {
      if (assetB === "vault") {
        return [this.ecosystemConfig.dex2PoolReserve, this.ecosystemConfig.dex2VaultReserve]
      } else if (assetB === "fAsset") {
        return [this.ecosystemConfig.dex3PoolReserve, this.ecosystemConfig.dex3FAssetReserve]
      }
    } else if (assetA === "vault") {
      if (assetB === "pool") {
        return [this.ecosystemConfig.dex2VaultReserve, this.ecosystemConfig.dex2PoolReserve]
      } else if (assetB === "fAsset") {
        return [this.ecosystemConfig.dex1VaultReserve, this.ecosystemConfig.dex1FAssetReserve]
      }
    } else if (assetA === "fAsset") {
      if (assetB === "pool") {
        return [this.ecosystemConfig.dex3FAssetReserve, this.ecosystemConfig.dex3PoolReserve]
      } else if (assetB === "vault") {
        return [this.ecosystemConfig.dex1FAssetReserve, this.ecosystemConfig.dex1VaultReserve]
      }
    }
    throw Error("invalid assets")
  }

  currentLiquidationFactorBIPS(): [bigint, bigint] {
    return currentLiquidationFactorBIPS(
      this.ecosystemConfig.liquidationFactorBips,
      this.ecosystemConfig.liquidationFactorVaultBips
    )
  }

  amgToTokenPrice(asset: UnderlyingAsset, collateral: CollateralAsset): bigint {
    const collateralFtsoPrice = (collateral.kind === "vault")
      ? this.ecosystemConfig.vaultFtsoPrice
      : this.ecosystemConfig.poolFtsoPrice
    return amgToTokenPrice(
      asset.amgDecimals, asset.ftsoDecimals, this.ecosystemConfig.assetFtsoPrice,
      collateral.decimals, collateral.ftsoDecimals, collateralFtsoPrice
    )
  }

  liquidationOutput(fAssetAmount: bigint): [bigint, bigint] {
    const fAssetAmountAmg = ubaToAmg(this.assetConfig.asset, fAssetAmount)
    const amgToVaultPrice = this.amgToTokenPrice(this.assetConfig.asset, this.assetConfig.vault)
    const amgToPoolPrice = this.amgToTokenPrice(this.assetConfig.asset, this.assetConfig.pool)
    const [vaultFactorBIPS, poolFactorBIPS] = this.currentLiquidationFactorBIPS()
    return liquidationOutput(fAssetAmountAmg, vaultFactorBIPS, poolFactorBIPS, amgToVaultPrice, amgToPoolPrice)
  }

  calculateArbitrageProfit(amountVault: bigint): bigint {
    const [paths1, paths2] = this.pathConfig
    const reserves1 = []
    for (let i = 1; i < paths1.length; i++) {
      reserves1.push(this.reservesFromAssets(paths1[i-1], paths1[i]))
    }
    const reserves2 = []
    for (let i = 1; i < paths2.length; i++) {
      reserves2.push(this.reservesFromAssets(paths2[i-1], paths2[i]))
    }
    // begin
    const [fAssetToLiquidate] = swapOutputs([amountVault], [paths1], [reserves1])
    const [liquidationPayoutVault, liquidationPayoutPool] = this.liquidationOutput(fAssetToLiquidate)
    const [,vaultFromPool] = swapOutputs([amountVault, liquidationPayoutPool], [paths1, paths2], [reserves2, reserves2])
    return liquidationPayoutVault + vaultFromPool - amountVault
  }

}