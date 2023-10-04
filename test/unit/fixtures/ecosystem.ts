import { AssetConfig, EcosystemConfig } from "./interface"
import { lotSizeUba, toBN, expBN, randBnInRadius, randBnInRelRadius } from "../helpers/utils"
import { priceBasedDexReserve, collateralForCr } from "../helpers/contract-utils"


export class EcosystemFactory {
  // fixed default values
  protected defaultDex1FAssetReserve: BN
  protected defaultDex2VaultReserve: BN
  protected defaultMintedUBA: BN
  // fixed example ecosystem configs
  protected baseEcosystem: EcosystemConfig
  public healthyEcosystemWithVaultUnderwater: EcosystemConfig
  public healthyEcosystemWithPoolUnderwater: EcosystemConfig
  public healthyEcosystemWithZeroVaultCollateral: EcosystemConfig
  public healthyEcosystemWithZeroPoolCollateral: EcosystemConfig
  public semiHealthyEcosystem: EcosystemConfig
  public unhealthyEcosystem: EcosystemConfig

  constructor(public config: AssetConfig) {
    // determine default values
    this.defaultDex1FAssetReserve = expBN(config.asset.decimals + 10)
    this.defaultDex2VaultReserve = expBN(config.vault.decimals + 10)
    this.defaultMintedUBA = lotSizeUba(config.asset).muln(1e5)
    // get fixed example ecosystem configs
    this.baseEcosystem = this.getBaseEcosystem()
    this.healthyEcosystemWithVaultUnderwater = this.getHealthyEcosystemWithVaultUnderwater()
    this.healthyEcosystemWithPoolUnderwater = this.getHealthyEcosystemWithPoolUnderwater()
    this.healthyEcosystemWithZeroVaultCollateral = this.getHealthyEcosystemWithZeroVaultCollateral()
    this.healthyEcosystemWithZeroPoolCollateral = this.getHealthyEcosystemWithZeroPoolCollateral()
    this.semiHealthyEcosystem = this.getSemiHealthyEcosystem()
    this.unhealthyEcosystem = this.getUnhealthyEcosystem()
  }

  protected getBaseEcosystem(): EcosystemConfig {
    return {
      name: 'base healthy ecosystem config',
      // ftso prices reflect the real ones (in usd5)
      assetFtsoPrice: this.config.asset.defaultPriceUsd5,
      vaultFtsoPrice: this.config.vault.defaultPriceUsd5,
      poolFtsoPrice: this.config.pool.defaultPriceUsd5,
      // dexes are sufficiently liquidated and
      // reserves are aligned with ftso prices
      dex1FAssetReserve: this.defaultDex1FAssetReserve,
      dex1VaultReserve: priceBasedDexReserve(
        this.config.asset.defaultPriceUsd5,
        this.config.vault.defaultPriceUsd5,
        this.config.asset.decimals,
        this.config.vault.decimals,
        this.defaultDex1FAssetReserve
      ),
      dex2VaultReserve: this.defaultDex2VaultReserve,
      dex2PoolReserve: priceBasedDexReserve(
        this.config.vault.defaultPriceUsd5,
        this.config.pool.defaultPriceUsd5,
        this.config.vault.decimals,
        this.config.pool.decimals,
        this.defaultDex2VaultReserve
      ),
      // we set agent collateral such that
      // collateral ratios are stable
      mintedUBA: this.defaultMintedUBA,
      vaultCollateral: collateralForCr(
        15_000, // mincr = 150%
        this.defaultMintedUBA,
        this.config.asset.defaultPriceUsd5,
        this.config.vault.defaultPriceUsd5,
        this.config.asset.decimals,
        this.config.vault.decimals
      ),
      poolCollateral: collateralForCr(
        20_000, // mincr = 200%
        this.defaultMintedUBA,
        this.config.asset.defaultPriceUsd5,
        this.config.pool.defaultPriceUsd5,
        this.config.asset.decimals,
        this.config.pool.decimals
      ),
      poolRedeemingFAsset: toBN(0),
      vautRedeemingFAsset: toBN(0),
      // asset manager has reasonable liquidation settings
      liquidationFactorBips: toBN(12_000),
      liquidationFactorVaultBips: toBN(10_000),
      // configs should implicitly set the following data
      expectedVaultCrBips: toBN(15_000),
      expectedPoolCrBips: toBN(20_000)
    }
  }

  protected getHealthyEcosystemWithVaultUnderwater(): EcosystemConfig {
    return {
      ...this.baseEcosystem,
      name: 'vault cr underwater',
      vaultCollateral: collateralForCr(
        12_000,
        this.defaultMintedUBA,
        this.baseEcosystem.assetFtsoPrice,
        this.baseEcosystem.vaultFtsoPrice,
        this.config.asset.decimals,
        this.config.vault.decimals
      ),
      expectedVaultCrBips: toBN(12_000)
    }
  }

  protected getHealthyEcosystemWithPoolUnderwater(): EcosystemConfig {
    return {
      ...this.baseEcosystem,
      name: 'pool cr underwater',
      poolCollateral: collateralForCr(
        14_000,
        this.defaultMintedUBA,
        this.baseEcosystem.assetFtsoPrice,
        this.baseEcosystem.poolFtsoPrice,
        this.config.asset.decimals,
        this.config.pool.decimals
      ),
      expectedPoolCrBips: toBN(14_000)
    }
  }

  protected getHealthyEcosystemWithZeroVaultCollateral(): EcosystemConfig {
    return {
      ...this.baseEcosystem,
      name: 'vault cr is 0, pool ftw',
      vaultCollateral: toBN(0),
      expectedVaultCrBips: toBN(0)
    }
  }

  protected getHealthyEcosystemWithZeroPoolCollateral(): EcosystemConfig {
    return {
      ...this.baseEcosystem,
      name: 'pool cr is 0, vault ftw',
      poolCollateral: toBN(0),
      expectedPoolCrBips: toBN(0)
    }
  }

  protected getSemiHealthyEcosystem(): EcosystemConfig {
    return {
      ...this.healthyEcosystemWithVaultUnderwater,
      name: 'arbitrage not possible, dex1 has too high slippage due to low liquidity',
      // make dex1 f-assets have same price but low liquidity
      dex1FAssetReserve: this.defaultMintedUBA.muln(10).divn(9),
      dex1VaultReserve: priceBasedDexReserve(
        this.config.asset.defaultPriceUsd5,
        this.config.vault.defaultPriceUsd5,
        this.config.asset.decimals,
        this.config.vault.decimals,
        this.defaultMintedUBA.muln(10).divn(9)
      ),
      // force full liquidation
      vaultCollateral: toBN(0),
      expectedVaultCrBips: toBN(0)
    }
  }

  protected getUnhealthyEcosystem(): EcosystemConfig {
    return {
      ...this.healthyEcosystemWithVaultUnderwater,
      name: 'arbitrage not possible, dex1 f-asset price too high',
      // make dex f-assets 100x more expensive than on the ftso
      dex1FAssetReserve: this.healthyEcosystemWithVaultUnderwater.dex1FAssetReserve.divn(100),
    }
  }

  protected getRandomizedHealthyEcosystem(name: string): EcosystemConfig {
    // slightly randomized crs
    const vaultCrBips = randBnInRadius(14_000, 500)
    const poolCrBips = randBnInRadius(18_000, 4_000)
    // slightly randomized ftso prices
    const ftsoPrices = {
      assetFtsoPrice: randBnInRelRadius(this.baseEcosystem.assetFtsoPrice, 2),
      vaultFtsoPrice: randBnInRelRadius(this.baseEcosystem.vaultFtsoPrice, 1),
      poolFtsoPrice: randBnInRelRadius(this.baseEcosystem.poolFtsoPrice, 2),
    }
    // randomized config
    return {
      ...this.baseEcosystem,
      ...ftsoPrices,
      name: name,
      // slightly randomized dex reserves
      dex1VaultReserve: randBnInRelRadius(this.baseEcosystem.dex1VaultReserve, 2),
      dex1FAssetReserve: randBnInRelRadius(this.baseEcosystem.dex1FAssetReserve, 2),
      dex2PoolReserve: randBnInRelRadius(this.baseEcosystem.dex2PoolReserve, 2),
      dex2VaultReserve: randBnInRelRadius(this.baseEcosystem.dex2VaultReserve, 2),
      // slightly randomized minted f-assets
      vaultCollateral: collateralForCr(
        vaultCrBips,
        this.defaultMintedUBA,
        ftsoPrices.assetFtsoPrice,
        ftsoPrices.vaultFtsoPrice,
        this.config.asset.decimals,
        this.config.vault.decimals
      ),
      poolCollateral: collateralForCr(
        poolCrBips,
        this.defaultMintedUBA,
        ftsoPrices.assetFtsoPrice,
        ftsoPrices.poolFtsoPrice,
        this.config.asset.decimals,
        this.config.pool.decimals
      ),
      expectedVaultCrBips: vaultCrBips,
      expectedPoolCrBips: poolCrBips
    }
  }

  public getHealthyEcosystems(count: number): EcosystemConfig[] {
    const configs: EcosystemConfig[] = [
      this.healthyEcosystemWithVaultUnderwater,
      this.healthyEcosystemWithPoolUnderwater,
      this.healthyEcosystemWithZeroVaultCollateral,
      this.healthyEcosystemWithZeroPoolCollateral
    ]
    for (let i = 0; i < count; i++) {
      configs.push(this.getRandomizedHealthyEcosystem(`randomized healthy ecosystem ${i}`))
    }
    return configs
  }

  public getSemiHealthyEcosystems(count: number): EcosystemConfig[] {
    return [this.semiHealthyEcosystem]
  }

  public getUnhealthyEcosystems(count: number): EcosystemConfig[] {
    return [this.unhealthyEcosystem]
  }
}