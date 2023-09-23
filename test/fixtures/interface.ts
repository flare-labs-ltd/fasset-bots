import BN from 'bn.js'

export interface CollateralInfo {
  name: string,
  symbol: string,
  decimals: number,
  ftsoDecimals: number,
  defaultPriceUsd5: BN,
  minCollateralRatioBips?: BN
}

export interface AssetInfo extends CollateralInfo {
  amgDecimals: number,
  lotSize: number
}

export interface EcosystemConfig {
  name: string,
  // ftso prices
  assetFtsoPrice: BN,
  vaultFtsoPrice: BN,
  poolFtsoPrice: BN,
  // dex(vault, f-asset)
  dex1VaultReserve: BN,
  dex1FAssetReserve: BN,
  // dex(pool, vault)
  dex2PoolReserve: BN,
  dex2VaultReserve: BN,
  // agent settings
  mintedUBA: BN,
  vaultCollateral: BN,
  poolCollateral: BN,
  poolRedeemingFAsset: BN,
  vautRedeemingFAsset: BN,
  // asset manager settings
  liquidationFactorBips: BN,
  liquidationFactorVaultBips: BN,
  // expected implicit data
  expectedVaultCrBips: BN,
  expectedPoolCrBips: BN
}