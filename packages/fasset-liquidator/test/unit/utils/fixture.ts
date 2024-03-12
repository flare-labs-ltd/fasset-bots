import {
    consecutiveSwapOutputs, swapInputs,
    amgToTokenPrice, liquidationOutput,
    currentLiquidationFactorBIPS, maxLiquidationAmountAmg
} from "../../calculations/calculations"
import { amgToUba, ubaToAmg } from "./assets"
import type { EcosystemConfig, AssetConfig, UnderlyingAsset, CollateralAsset } from "../fixtures/interfaces"

export class FixtureUtils {

  constructor(
    private assetConfig: AssetConfig,
    private ecosystemConfig: EcosystemConfig,
    private pathConfig: [string[], string[]]
  ) {}

  arbitrageProfit(amountVault: bigint): bigint {
    const [paths1, paths2] = this.pathConfig
    const [reserves1, reserves2] = this.getDexReserves()
    const [fAssetToLiquidate] = consecutiveSwapOutputs([amountVault], [paths1], [reserves1])
    const [liquidationPayoutVault, liquidationPayoutPool] = this.liquidationOutput(fAssetToLiquidate)
    const [,vaultFromPool] = consecutiveSwapOutputs([amountVault, liquidationPayoutPool], [paths1, paths2], [reserves1, reserves2])
    return liquidationPayoutVault + vaultFromPool - amountVault
  }

  vaultSwapInFromFAssetOut(amountFAsset: bigint): bigint {
    const [reserves] = this.getDexReserves()
    return swapInputs(amountFAsset, reserves)
  }

  liquidationOutput(amountFAsset: bigint): [bigint, bigint] {
    const amountFAssetAmg = ubaToAmg(this.assetConfig.asset, amountFAsset)
    const amgToVaultPrice = this.amgToTokenPrice(this.assetConfig.asset, this.assetConfig.vault)
    const amgToPoolPrice = this.amgToTokenPrice(this.assetConfig.asset, this.assetConfig.pool)
    const [vaultFactorBIPS, poolFactorBIPS] = this.currentLiquidationFactorBIPS()
    return liquidationOutput(amountFAssetAmg, vaultFactorBIPS, poolFactorBIPS, amgToVaultPrice, amgToPoolPrice)
  }

  maxLiquidatedFAsset(): bigint {
    const [liquidationFactorVault, liquidationFactorPool] = this.currentLiquidationFactorBIPS()
    const maxLiquidatedBcVault = this.maxLiquidationAmountAmg(
      this.ecosystemConfig.expectedVaultCrBips,
      liquidationFactorVault,
      this.assetConfig.vault.minCollateralRatioBips
    )
    const maxLiquidatedBcPool = this.maxLiquidationAmountAmg(
      this.ecosystemConfig.expectedPoolCrBips,
      liquidationFactorPool,
      this.assetConfig.pool.minCollateralRatioBips
    )
    return amgToUba(
      this.assetConfig.asset,
      (maxLiquidatedBcVault > maxLiquidatedBcPool)
        ? maxLiquidatedBcVault
        : maxLiquidatedBcPool
    )
  }

  currentLiquidationFactorBIPS(): [bigint, bigint] {
    return currentLiquidationFactorBIPS(
      this.ecosystemConfig.liquidationFactorBips,
      this.ecosystemConfig.liquidationFactorVaultBips,
      this.ecosystemConfig.expectedVaultCrBips,
      this.ecosystemConfig.expectedPoolCrBips
    )
  }

  protected amgToTokenPrice(asset: UnderlyingAsset, collateral: CollateralAsset): bigint {
    const collateralFtsoPrice = (collateral.kind === "vault")
      ? this.ecosystemConfig.vaultFtsoPrice
      : this.ecosystemConfig.poolFtsoPrice
    return amgToTokenPrice(
      asset.amgDecimals, asset.ftsoDecimals, this.ecosystemConfig.assetFtsoPrice,
      collateral.decimals, collateral.ftsoDecimals, collateralFtsoPrice
    )
  }

  protected maxLiquidationAmountAmg(
    collateralRatioBips: bigint,
    factorBips: bigint,
    targetRatioBips: bigint
  ): bigint {
    const mintedAmg = ubaToAmg(this.assetConfig.asset, this.ecosystemConfig.mintedUBA)
    return maxLiquidationAmountAmg(
      collateralRatioBips, factorBips, targetRatioBips, mintedAmg,
      this.assetConfig.asset.lotSize, this.ecosystemConfig.fullLiquidation
    )
  }

  protected getDexReserves(): [[bigint, bigint][], [bigint, bigint][]] {
    const [paths1, paths2] = this.pathConfig
    const reserves1 = []
    for (let i = 1; i < paths1.length; i++) {
      reserves1.push(this.reservesFromAssets(paths1[i-1], paths1[i]))
    }
    const reserves2 = []
    for (let i = 1; i < paths2.length; i++) {
      reserves2.push(this.reservesFromAssets(paths2[i-1], paths2[i]))
    }
    return [reserves1, reserves2]
  }

  protected reservesFromAssets(assetA: string, assetB: string): [bigint, bigint] {
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

}