import BN from 'bn.js'

export interface CollateralInfo {
  name: string,
  symbol: string,
  decimals: number,
  ftsoDecimals: number
}

export interface AssetInfo extends CollateralInfo {
  minCrBips: number,
  amgDecimals: number,
  lotSize: number
}

export interface EcosystemConfig {
  name: string,
  // ftso prices
  ftsoAssetPrice: BN,
  ftsoVaultPrice: BN,
  ftsoPoolPrice: BN,
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
  // expected implicit data
  expectedVaultCr: BN,
  expectedPoolCr: BN
}