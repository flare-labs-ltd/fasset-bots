interface BaseAsset {
  name: string
  symbol: string
  decimals: bigint
  ftsoSymbol: string
  ftsoDecimals: bigint
  defaultPriceUsd5: bigint
}

export interface CollateralAsset extends BaseAsset {
  kind: "vault" | "pool"
  minCollateralRatioBips: bigint
}

export interface UnderlyingAsset extends BaseAsset {
  amgDecimals: bigint
  lotSize: bigint
}

export interface AssetConfig {
  asset: UnderlyingAsset
  vault: CollateralAsset
  pool: CollateralAsset
}

export interface EcosystemConfig {
  name: string
  // ftso prices
  assetFtsoPrice: bigint
  vaultFtsoPrice: bigint
  poolFtsoPrice: bigint
  // dex(vault, f-asset)
  dex1VaultReserve: bigint
  dex1FAssetReserve: bigint
  // dex(pool, vault)
  dex2PoolReserve: bigint
  dex2VaultReserve: bigint
  // agent settings
  mintedUBA: bigint
  vaultCollateral: bigint
  poolCollateral: bigint
  // asset manager settings
  liquidationFactorBips: bigint
  liquidationFactorVaultBips: bigint
  // expected implicit data
  expectedVaultCrBips: bigint
  expectedPoolCrBips: bigint
}