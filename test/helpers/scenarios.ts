import { EcosystemConfig } from "./interface"
import { lotSizeUba, BNish, toBN, expBN, randBn, getPriceBasedDexReserve, collateralForCr } from "./utils"
import { USDT as VAULT, WNAT as POOL, XRP as ASSET } from "./assets"

const idealFAssetReserve = expBN(ASSET.decimals + 10)
const idealPoolReserve = expBN(POOL.decimals + 12)
const idealMintedUBA = lotSizeUba(ASSET).muln(1e5)

const baseEcosystem: EcosystemConfig = {
  name: 'ideal ecosystem config',
  // ftso prices reflect the real ones (in usd5)
  ftsoAssetPrice: toBN(50_000),
  ftsoVaultPrice: toBN(100_000),
  ftsoPoolPrice: toBN(1333),
  // dexes are sufficiently liquidated and
  // reserves are aligned with ftso prices
  dex1FAssetReserve: idealFAssetReserve,
  dex1VaultReserve: getPriceBasedDexReserve(
    50_000,
    100_000,
    ASSET.decimals,
    VAULT.decimals,
    idealFAssetReserve
  ),
  dex2PoolReserve: idealPoolReserve,
  dex2VaultReserve: getPriceBasedDexReserve(
    1333,
    100_000,
    POOL.decimals,
    VAULT.decimals,
    idealPoolReserve
  ),
  // we set agent collateral such that
  // collateral ratios are stable
  mintedUBA: idealMintedUBA,
  vaultCollateral: collateralForCr(
    20_000, // mincr = 150%
    idealMintedUBA,
    50_000,
    100_000,
    ASSET.decimals,
    VAULT.decimals
  ),
  poolCollateral: collateralForCr(
    20_000, // mincr = 150%
    idealMintedUBA,
    50_000,
    1333,
    ASSET.decimals,
    POOL.decimals
  ),
  poolRedeemingFAsset: toBN(0),
  vautRedeemingFAsset: toBN(0),
  // configs should implicitly set the following data
  expectedVaultCr: toBN(20_000),
  expectedPoolCr: toBN(20_000)
}

// configs where the ecosystem allows for full agent liquidation
export const healthyEcosystemConfigs: EcosystemConfig[] = [
  {
    ...baseEcosystem,
    name: 'vault cr underwater',
    vaultCollateral: collateralForCr(
      12_000,
      idealMintedUBA,
      baseEcosystem.ftsoAssetPrice,
      baseEcosystem.ftsoVaultPrice,
      ASSET.decimals,
      VAULT.decimals
    ),
    expectedVaultCr: toBN(12_000)
  },
  {
    ...baseEcosystem,
    name: 'pool cr underwater',
    poolCollateral: collateralForCr(
      11_000,
      idealMintedUBA,
      baseEcosystem.ftsoAssetPrice,
      baseEcosystem.ftsoPoolPrice,
      ASSET.decimals,
      POOL.decimals
    ),
    expectedPoolCr: toBN(11_000)
  }
]

const randBnInRelRadius = (center: BNish, radiusPerc: BNish) => {
  const radius = toBN(center).mul(toBN(radiusPerc)).divn(100)
  return randBn(toBN(center).sub(radius), toBN(center).add(radius))
}

for (let i = 0; i < 10; i++) {
  // slightly randomized crs
  const vaultCr = randBnInRelRadius(14_000, 10)
  const poolCr = randBnInRelRadius(14_000, 10)
  // slightly randomized ftso prices
  const prices = {
    ftsoAssetPrice: randBnInRelRadius(baseEcosystem.ftsoAssetPrice, 5),
    ftsoVaultPrice: randBnInRelRadius(baseEcosystem.ftsoVaultPrice, 2),
    ftsoPoolPrice: randBnInRelRadius(baseEcosystem.ftsoPoolPrice, 5),
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
      vaultCr, // mincr = 150%
      idealMintedUBA,
      prices.ftsoAssetPrice,
      prices.ftsoVaultPrice,
      ASSET.decimals,
      VAULT.decimals
    ),
    poolCollateral: collateralForCr(
      poolCr, // mincr = 150%
      idealMintedUBA,
      prices.ftsoAssetPrice,
      prices.ftsoPoolPrice,
      ASSET.decimals,
      POOL.decimals
    ),
    expectedVaultCr: vaultCr,
    expectedPoolCr: poolCr
  })
}

// configs where the ecosystem is in a bad state
/* export const unhealthyEcosystemConfigs: EcosystemConfig[] = [
  {
    ...baseEcosystem,
    name: 'unhealthy base',
    modifyVaultCr: true,
  }
] */
