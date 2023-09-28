import BN from 'bn.js'
import { UnderlyingAsset } from '../fixtures/interface'


export async function sleep(milliseconds: number) {
  await new Promise((resolve: any) => {
    setTimeout(() => {
      resolve()
    }, milliseconds)
  })
}

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

////////////////////////////////////////////////////////////////////////////
// bn extensions

export type BNish = number | string | BN

export const toBN = (x: BNish) => new BN(x)

export const minBN = (a: BN, b: BN) => a.lt(b) ? a : b

export const expBN = (y: BNish) => toBN(10).pow(toBN(y))

function getrandbit(): BN {
  return toBN(Number(Math.random() > 0.5))
}

// not really uniformly random, but it'll do
export function randBn(min: BNish, max: BNish): any {
  const ret = toBN(min)
  const diff = toBN(max).sub(ret)
  const bitlen = diff.bitLength()
  let boundbit = true
  for (let i = bitlen-1; i >= 0; i--) {
    const randbit = getrandbit()
    if (boundbit) {
      if (diff.testn(i)) {
        ret.iadd(randbit.shln(i))
        boundbit = randbit.eqn(1)
      }
    }
    else {
      ret.iadd(toBN(randbit).shln(i))
    }
  }
  return ret
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
