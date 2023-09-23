import { EcosystemConfig } from "./interface"
import { lotSizeUba, toBN, expBN, randBnInRadius, randBnInRelRadius, priceBasedDexReserve, collateralForCr } from "./utils"
import { USDT as VAULT, WNAT as POOL, XRP as ASSET } from "./assets"

const defaultDex1FAssetReserve = expBN(ASSET.decimals + 10)
const defaultDex2VaultReserve = expBN(VAULT.decimals + 10)
const defaultMintedUBA = lotSizeUba(ASSET).muln(1e5)

const baseEcosystem: EcosystemConfig = {
  name: 'base healthy ecosystem config',
  // ftso prices reflect the real ones (in usd5)
  assetFtsoPrice: ASSET.defaultPriceUsd5,
  vaultFtsoPrice: VAULT.defaultPriceUsd5,
  poolFtsoPrice: POOL.defaultPriceUsd5,
  // dexes are sufficiently liquidated and
  // reserves are aligned with ftso prices
  dex1FAssetReserve: defaultDex1FAssetReserve,
  dex1VaultReserve: priceBasedDexReserve(
    ASSET.defaultPriceUsd5,
    VAULT.defaultPriceUsd5,
    ASSET.decimals,
    VAULT.decimals,
    defaultDex1FAssetReserve
  ),
  dex2VaultReserve: defaultDex2VaultReserve,
  dex2PoolReserve: priceBasedDexReserve(
    VAULT.defaultPriceUsd5,
    POOL.defaultPriceUsd5,
    VAULT.decimals,
    POOL.decimals,
    defaultDex2VaultReserve
  ),
  // we set agent collateral such that
  // collateral ratios are stable
  mintedUBA: defaultMintedUBA,
  vaultCollateral: collateralForCr(
    15_000, // mincr = 150%
    defaultMintedUBA,
    ASSET.defaultPriceUsd5,
    VAULT.defaultPriceUsd5,
    ASSET.decimals,
    VAULT.decimals
  ),
  poolCollateral: collateralForCr(
    20_000, // mincr = 200%
    defaultMintedUBA,
    ASSET.defaultPriceUsd5,
    POOL.defaultPriceUsd5,
    ASSET.decimals,
    POOL.decimals
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

// ecosystems where a full liquidation is the most profitable
export const healthyEcosystemConfigs: EcosystemConfig[] = [
  {
    ...baseEcosystem,
    name: 'vault cr underwater',
    vaultCollateral: collateralForCr(
      12_000,
      defaultMintedUBA,
      baseEcosystem.assetFtsoPrice,
      baseEcosystem.vaultFtsoPrice,
      ASSET.decimals,
      VAULT.decimals
    ),
    expectedVaultCrBips: toBN(12_000)
  },
  {
    ...baseEcosystem,
    name: 'pool cr underwater',
    poolCollateral: collateralForCr(
      14_000,
      defaultMintedUBA,
      baseEcosystem.assetFtsoPrice,
      baseEcosystem.poolFtsoPrice,
      ASSET.decimals,
      POOL.decimals
    ),
    expectedPoolCrBips: toBN(14_000)
  },
  {
    ...baseEcosystem,
    name: 'vault cr is 0, pool ftw',
    vaultCollateral: toBN(0),
    expectedVaultCrBips: toBN(0)
  }
]

for (let i = 0; i < 10; i++) {
  // slightly randomized crs
  const vaultCrBips = randBnInRadius(14_000, 500)
  const poolCrBips = randBnInRadius(18_000, 4_000)
  // slightly randomized ftso prices
  const ftsoPrices = {
    assetFtsoPrice: randBnInRelRadius(baseEcosystem.assetFtsoPrice, 3),
    vaultFtsoPrice: randBnInRelRadius(baseEcosystem.vaultFtsoPrice, 1),
    poolFtsoPrice: randBnInRelRadius(baseEcosystem.poolFtsoPrice, 3),
  }
  healthyEcosystemConfigs.push({
    ...baseEcosystem,
    ...ftsoPrices,
    name: 'randomly randomized healthy ecosystem ' + i,
    // slightly randomized dex reserves
    dex1VaultReserve: randBnInRelRadius(baseEcosystem.dex1VaultReserve, 2),
    dex1FAssetReserve: randBnInRelRadius(baseEcosystem.dex1FAssetReserve, 2),
    dex2PoolReserve: randBnInRelRadius(baseEcosystem.dex2PoolReserve, 2),
    dex2VaultReserve: randBnInRelRadius(baseEcosystem.dex2VaultReserve, 2),
    // slightly randomized minted f-assets
    vaultCollateral: collateralForCr(
      vaultCrBips,
      defaultMintedUBA,
      ftsoPrices.assetFtsoPrice,
      ftsoPrices.vaultFtsoPrice,
      ASSET.decimals,
      VAULT.decimals
    ),
    poolCollateral: collateralForCr(
      poolCrBips,
      defaultMintedUBA,
      ftsoPrices.assetFtsoPrice,
      ftsoPrices.poolFtsoPrice,
      ASSET.decimals,
      POOL.decimals
    ),
    expectedVaultCrBips: vaultCrBips,
    expectedPoolCrBips: poolCrBips
  })
}

// ecosystems where a partial liquidation is the most profitable
export const semiHealthyEcosystemConfigs: EcosystemConfig[] = [
  {
    ...healthyEcosystemConfigs[0],
    name: 'arbitrage not possible, dex1 has too high slippage due to low liquidity',
    // make dex1 f-assets have same price but low liquidity
    dex1FAssetReserve: defaultMintedUBA.muln(10).divn(9),
    dex1VaultReserve: priceBasedDexReserve(
      ASSET.defaultPriceUsd5,
      VAULT.defaultPriceUsd5,
      ASSET.decimals,
      VAULT.decimals,
      defaultMintedUBA.muln(10).divn(9)
    ),
    // force full liquidation
    vaultCollateral: toBN(0),
    expectedVaultCrBips: toBN(0)
  }
]

// ecosystems that do not allow for a profitable liquidation
export const unhealthyEcosystemConfigs: EcosystemConfig[] = [
  {
    ...healthyEcosystemConfigs[0],
    name: 'arbitrage not possible, dex1 f-asset price too high',
    // make dex f-assets 100x more expensive than on the ftso
    dex1FAssetReserve: healthyEcosystemConfigs[0].dex1FAssetReserve.divn(100),
  }
]
