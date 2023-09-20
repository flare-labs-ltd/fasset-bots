import { EcosystemConfig } from "./interface"
import { lotSizeUba, BNish, toBN, expBN, randBn, getPriceBasedDexReserve, collateralForCr } from "./utils"
import { USDT as VAULT, WNAT as POOL, XRP as ASSET, XRP } from "./assets"

const defaultFAssetReserve = expBN(ASSET.decimals + 10)
const defaultPoolReserve = expBN(POOL.decimals + 12)
const defaultMintedUBA = lotSizeUba(ASSET).muln(1e5)

const baseEcosystem: EcosystemConfig = {
  name: 'ideal ecosystem config',
  // ftso prices reflect the real ones (in usd5)
  assetFtsoPrice: XRP.defaultPriceUsd5,
  vaultFtsoPrice: VAULT.defaultPriceUsd5,
  poolFtsoPrice: POOL.defaultPriceUsd5,
  // dexes are sufficiently liquidated and
  // reserves are aligned with ftso prices
  dex1FAssetReserve: defaultFAssetReserve,
  dex1VaultReserve: getPriceBasedDexReserve(
    XRP.defaultPriceUsd5,
    VAULT.defaultPriceUsd5,
    ASSET.decimals,
    VAULT.decimals,
    defaultFAssetReserve
  ),
  dex2PoolReserve: defaultPoolReserve,
  dex2VaultReserve: getPriceBasedDexReserve(
    POOL.defaultPriceUsd5,
    VAULT.defaultPriceUsd5,
    POOL.decimals,
    VAULT.decimals,
    defaultPoolReserve
  ),
  // we set agent collateral such that
  // collateral ratios are stable
  mintedUBA: defaultMintedUBA,
  vaultCollateral: collateralForCr(
    20_000, // mincr = 150%
    defaultMintedUBA,
    XRP.defaultPriceUsd5,
    VAULT.defaultPriceUsd5,
    ASSET.decimals,
    VAULT.decimals
  ),
  poolCollateral: collateralForCr(
    20_000, // mincr = 200%
    defaultMintedUBA,
    XRP.defaultPriceUsd5,
    POOL.defaultPriceUsd5,
    ASSET.decimals,
    POOL.decimals
  ),
  poolRedeemingFAsset: toBN(0),
  vautRedeemingFAsset: toBN(0),
  // configs should implicitly set the following data
  expectedVaultCrBips: toBN(20_000),
  expectedPoolCrBips: toBN(20_000)
}

// configs where the ecosystem allows for full agent liquidation
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
  }
]

const randBnInRadius = (center: BNish, radius: BNish) => {
  const min = toBN(center).sub(toBN(radius))
  const max = toBN(center).add(toBN(radius))
  return randBn(min, max)
}

const randBnInRelRadius = (center: BNish, radiusPerc: BNish) => {
  const radius = toBN(center).mul(toBN(radiusPerc)).divn(100)
  return randBnInRadius(center, radius)
}

for (let i = 0; i < 10; i++) {
  // slightly randomized crs
  const vaultCrBips = randBnInRadius(14_000, 1000)
  const poolCrBips = randBnInRadius(18_000, 4000)
  // slightly randomized ftso prices
  const prices = {
    assetFtsoPrice: randBnInRelRadius(baseEcosystem.assetFtsoPrice, 3),
    vaultFtsoPrice: randBnInRelRadius(baseEcosystem.vaultFtsoPrice, 1),
    poolFtsoPrice: randBnInRelRadius(baseEcosystem.poolFtsoPrice, 3),
  }
  healthyEcosystemConfigs.push({
    ...baseEcosystem,
    ...prices,
    name: 'randomly randomized healthy ecosystem ' + i,
    // slightly randomized dex reserves
    dex1VaultReserve: randBnInRelRadius(baseEcosystem.dex1VaultReserve, 2),
    dex1FAssetReserve: randBnInRelRadius(baseEcosystem.dex1FAssetReserve, 2),
    dex2PoolReserve: randBnInRelRadius(baseEcosystem.dex2PoolReserve, 2),
    dex2VaultReserve: randBnInRelRadius(baseEcosystem.dex2VaultReserve, 2),
    // slightly randomized minted f-assets
    vaultCollateral: collateralForCr(
      vaultCrBips, // mincr = 150%
      defaultMintedUBA,
      prices.assetFtsoPrice,
      prices.vaultFtsoPrice,
      ASSET.decimals,
      VAULT.decimals
    ),
    poolCollateral: collateralForCr(
      poolCrBips, // mincr = 200%
      defaultMintedUBA,
      prices.assetFtsoPrice,
      prices.poolFtsoPrice,
      ASSET.decimals,
      POOL.decimals
    ),
    expectedVaultCrBips: vaultCrBips,
    expectedPoolCrBips: poolCrBips
  })
}

// configs where the ecosystem is in a bad state
export const unhealthyEcosystemConfigs: EcosystemConfig[] = [
  {
    ...healthyEcosystemConfigs[0],
    name: 'arbitrage not possible, dex1 f-asset price too high',
    // make f-assets expensive af (in regards to ftso prices)
    dex1VaultReserve: baseEcosystem.dex1VaultReserve,
    dex1FAssetReserve: baseEcosystem.dex1FAssetReserve.divn(100),
  },
  {
    ...healthyEcosystemConfigs[0],
    name: 'arbitrage not possible, dex1 has high slippage (due to low liquidity)',
    // make dex1 f-assets have same price but low liquidity
    dex1FAssetReserve: healthyEcosystemConfigs[0].mintedUBA,
    dex1VaultReserve: getPriceBasedDexReserve(
      XRP.defaultPriceUsd5,
      VAULT.defaultPriceUsd5,
      ASSET.decimals,
      VAULT.decimals,
      defaultMintedUBA
    )
  }
]
