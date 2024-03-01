import type { UnderlyingAsset } from '../fixtures/interfaces'

export function lotSizeUba(fAsset: UnderlyingAsset): bigint {
    return BigInt(fAsset.lotSize) * BigInt(10) ** BigInt(fAsset.decimals)
  }

  export function lotSizeAmg(fAsset: UnderlyingAsset): bigint {
    return lotSizeUba(fAsset) / amgSizeUba(fAsset)
  }

  export function amgSizeUba(fAsset: UnderlyingAsset): bigint {
    return BigInt(10) ** BigInt(fAsset.decimals - fAsset.amgDecimals)
  }

  export function roundDownToAmg(fAsset: UnderlyingAsset, amount: bigint): bigint {
    return amount / amgSizeUba(fAsset) * amgSizeUba(fAsset)
  }

  export function ubaToAmg(fAsset: UnderlyingAsset, uba: bigint): bigint {
    return uba / amgSizeUba(fAsset)
  }

  export function amgToUba(fAsset: UnderlyingAsset, amg: bigint): bigint {
    return amg * amgSizeUba(fAsset)
  }