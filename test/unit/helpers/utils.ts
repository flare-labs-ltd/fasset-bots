
import BN from 'bn.js'
import { UnderlyingAsset } from '../fixtures/interface'
import * as crypto from 'crypto'

////////////////////////////////////////////////////////////////////////////
// f-asset conversions

export function lotSizeAmg(fAsset: UnderlyingAsset): BN {
  return lotSizeUba(fAsset).div(amgSizeUba(fAsset))
}

export function lotSizeUba(fAsset: UnderlyingAsset): BN {
  return toBN(fAsset.lotSize).mul(toBN(10).pow(toBN(fAsset.decimals)))
}

export function amgSizeUba(fAsset: UnderlyingAsset): BN {
  return toBN(10).pow(toBN(fAsset.decimals - fAsset.amgDecimals))
}

export function roundDownToAmg(fAsset: UnderlyingAsset, amount: BNish): BN {
  return toBN(amount).div(amgSizeUba(fAsset)).mul(amgSizeUba(fAsset))
}

export function ubaToAmg(fAsset: UnderlyingAsset, uba: BNish): BN {
  return toBN(uba).div(amgSizeUba(fAsset))
}

////////////////////////////////////////////////////////////////////////////
// bn extensions

export type BNish = number | string | BN

export const toBN = (x: BNish): BN => new BN(x)

export const minBN = (a: BN, b: BN): BN => a.lt(b) ? a : b

export const expBN = (y: BNish): BN => toBN(10).pow(toBN(y))

// not really uniformly random, but it'll do
export function randBn(min: BNish, max: BNish): BN {
  const diff = toBN(max).sub(toBN(min))
  const bitlen = diff.bitLength()
  const bytelen = Math.ceil(bitlen / 8)
  const randbytes = new BN(crypto.randomBytes(bytelen))
  return toBN(min).add(randbytes.mod(diff))
}

export const randBnInRadius = (center: BNish, radius: BNish) => {
  const min = toBN(center).sub(toBN(radius))
  const max = toBN(center).add(toBN(radius))
  return randBn(min, max)
}

export const randBnInRelRadius = (center: BNish, radiusPerc: BNish) => {
  const radius = toBN(center).mul(toBN(radiusPerc)).divn(100)
  return randBnInRadius(center, radius)
}

export function assertBnEqual(
  actual: BNish,
  expected: BNish,
  error: BNish = 0
) {
  const actualBN = toBN(actual)
  const expectedBN = toBN(expected)
  const errorBN = toBN(error)
  const diff = actualBN.sub(expectedBN).abs()
  if (diff.gt(errorBN)) {
    throw new Error(`Expected ${actualBN} to be within ${errorBN} of ${expectedBN}`)
  }
}

export function assertBnGreaterOrEqual(
  actual: BNish,
  expected: BNish
) {
  const actualBN = toBN(actual)
  const expectedBN = toBN(expected)
  if (actualBN.lt(expectedBN)) {
    throw new Error(`Expected ${actualBN} to be greater or euqal ${expectedBN}`)
  }
}
