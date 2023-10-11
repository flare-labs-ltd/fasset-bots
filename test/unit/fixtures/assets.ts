import type { CollateralAsset, UnderlyingAsset } from './interface'


/**
 * warning: ftsoDecimals should always be 5,
 * can't vauch for the correctness of tests executions otherwise
 */

export const XRP: UnderlyingAsset = {
  name: "Ripple",
  symbol: "XRP",
  decimals: BigInt(6),
  ftsoSymbol: "ftsoXRP",
  ftsoDecimals: BigInt(5),
  amgDecimals: BigInt(4),
  lotSize: BigInt(20),
  defaultPriceUsd5: BigInt(50_000)
}

export const USDT: CollateralAsset = {
  name: "Tether USD",
  symbol: "USDT",
  decimals: BigInt(18),
  ftsoSymbol: "ftsoUSDT",
  ftsoDecimals: BigInt(5),
  defaultPriceUsd5: BigInt(100_000),
  minCollateralRatioBips: BigInt(15_000),
  kind: "vault"
}

export const WFLR: CollateralAsset = {
  name: "Wrapped Flare",
  symbol: "WFLR",
  decimals: BigInt(18),
  ftsoSymbol: "ftsoWFLR",
  ftsoDecimals: BigInt(5),
  defaultPriceUsd5: BigInt(1_333),
  minCollateralRatioBips: BigInt(20_000),
  kind: "pool"
}

export const ETH: CollateralAsset = {
  name: "Ether",
  symbol: "ETH",
  decimals: BigInt(18),
  ftsoSymbol: "ftsoETH",
  ftsoDecimals: BigInt(5),
  defaultPriceUsd5: BigInt(165_030_000),
  minCollateralRatioBips: BigInt(18_000),
  kind: "vault"
}