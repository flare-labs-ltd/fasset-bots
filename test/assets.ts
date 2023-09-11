import { BNish, toBN } from './helpers/constants'

export interface Asset {
  name: string
  symbol: string
  decimals: number
  ftsoDecimals: number
  minCrBips?: number
  amgDecimals?: number
  lotSize?: number
}

export const fXRP = {
  name: "Flare Ripple",
  symbol: "fXRP",
  decimals: 6,
  minCrBips: 15_000,
  amgDecimals: 4,
  lotSize: 20,
  ftsoDecimals: 5
}

export const USDT = {
  name: "Tether USD",
  symbol: "USDT",
  decimals: 18,
  ftsoDecimals: 5
}

export const WNAT = {
  name: "Wrapped NAT",
  symbol: "WNAT",
  decimals: 18,
  ftsoDecimals: 5
}

export function lotSizeAmg(fAsset: any): BN {
  return lotSizeUba(fAsset).div(amgSizeUba(fAsset))
}

export function lotSizeUba(fAsset: any): BN {
  return toBN(fAsset.lotSize).mul(toBN(10).pow(toBN(fAsset.decimals)))
}

export function amgSizeUba(fAsset: any): BN {
  return toBN(10).pow(toBN(fAsset.decimals - fAsset.amgDecimals))
}

export function roundDownToAmg(fAsset: any, amount: BNish): BN {
  return toBN(amount).div(amgSizeUba(fAsset)).mul(amgSizeUba(fAsset))
}