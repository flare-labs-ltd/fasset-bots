import { CollateralInfo, AssetInfo } from './interface'

export const XRP: AssetInfo = {
  name: "Ripple",
  symbol: "XRP",
  decimals: 6,
  minCrBips: 15_000,
  amgDecimals: 4,
  lotSize: 20,
  ftsoDecimals: 5
}

export const USDT: CollateralInfo = {
  name: "Tether USD",
  symbol: "USDT",
  decimals: 18,
  ftsoDecimals: 5
}

export const WNAT: CollateralInfo = {
  name: "Wrapped NAT",
  symbol: "WNAT",
  decimals: 18,
  ftsoDecimals: 5
}

export const ETH: CollateralInfo = {
  name: "Ethereum",
  symbol: "ETH",
  decimals: 18,
  ftsoDecimals: 5
}