import BN from 'bn.js'
import { CollateralInfo, AssetInfo } from './interface'

export const XRP: AssetInfo = {
  name: "Ripple",
  symbol: "XRP",
  decimals: 6,
  amgDecimals: 4,
  lotSize: 20,
  ftsoDecimals: 5,
  defaultPriceUsd5: new BN(50_000)
}

export const USDT: CollateralInfo = {
  name: "Tether USD",
  symbol: "USDT",
  decimals: 18,
  ftsoDecimals: 5,
  defaultPriceUsd5: new BN(100_000),
  minCollateralRatioBips: new BN(15_000)
}

export const WNAT: CollateralInfo = {
  name: "Wrapped NAT",
  symbol: "WNAT",
  decimals: 18,
  ftsoDecimals: 5,
  defaultPriceUsd5: new BN(1_333),
  minCollateralRatioBips: new BN(20_000)
}

export const ETH: CollateralInfo = {
  name: "Ethereum",
  symbol: "ETH",
  decimals: 18,
  ftsoDecimals: 5,
  defaultPriceUsd5: new BN(1_650_300_000)
}