import BN from 'bn.js'
import { CollateralAsset, UnderlyingAsset } from './interface'


/**
 * warning: ftsoDecimals should always be 5,
 * can't vauch for the correctness of tests executions otherwise
 */

export const XRP: UnderlyingAsset = {
  name: "Ripple",
  symbol: "XRP",
  decimals: 6,
  ftsoSymbol: "XRP",
  ftsoDecimals: 5,
  amgDecimals: 4,
  lotSize: 20,
  defaultPriceUsd5: new BN(50_000)
}

export const USDT: CollateralAsset = {
  name: "Tether USD",
  symbol: "USDT",
  decimals: 18,
  ftsoSymbol: "USDT",
  ftsoDecimals: 5,
  defaultPriceUsd5: new BN(100_000),
  minCollateralRatioBips: new BN(15_000),
  kind: "vault"
}

export const WFLR: CollateralAsset = {
  name: "Wrapped Flare",
  symbol: "WFLR",
  decimals: 18,
  ftsoSymbol: "WFLR",
  ftsoDecimals: 5,
  defaultPriceUsd5: new BN(1_333),
  minCollateralRatioBips: new BN(20_000),
  kind: "pool"
}

export const ETH: CollateralAsset = {
  name: "Ether",
  symbol: "ETH",
  decimals: 18,
  ftsoSymbol: "ETH",
  ftsoDecimals: 5,
  defaultPriceUsd5: new BN(1_650_300_000),
  minCollateralRatioBips: new BN(18_000),
  kind: "vault"
}