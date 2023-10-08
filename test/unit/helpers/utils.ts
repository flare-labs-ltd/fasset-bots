
import { ethers } from 'hardhat'
import * as crypto from 'crypto'
import * as calc from '../../calculations'
import type { ERC20, BlazeSwapRouter, ERC20Mock } from '../../../types'
import type { UnderlyingAsset } from '../fixtures/interface'


////////////////////////////////////////////////////////////////////////////
// blaze swap

// calculates the amount of tokenB received
// when swapping amountA of tokenA
export async function swapOutput(
  router: BlazeSwapRouter,
  tokenIn: ERC20,
  tokenOut: ERC20,
  amountIn: bigint
): Promise<bigint> {
  const { 0: reserveIn, 1: reserveOut } = await router.getReserves(tokenIn, tokenOut)
  return calc.swapOutput(reserveIn, reserveOut, amountIn)
}

// calculates the amount of tokenB needed
// to swap to obtain amountA of tokenIn
export async function swapInput(
  router: BlazeSwapRouter,
  tokenIn: ERC20,
  tokenOut: ERC20,
  amountOut: bigint
): Promise<bigint> {
  const { 0: reserveIn, 1: reserveOut } = await router.getReserves(tokenIn, tokenOut)
  return calc.swapInput(reserveIn, reserveOut, amountOut)
}

export async function addLiquidity(
  router: BlazeSwapRouter,
  tokenA: ERC20Mock,
  tokenB: ERC20Mock,
  amountA: bigint,
  amountB: bigint,
  liquidityProvider: string
): Promise<void> {
  await tokenA.mint(liquidityProvider, amountA)
  await tokenB.mint(liquidityProvider, amountB)
  await tokenA.approve(router, amountA)
  await tokenB.approve(router, amountB)
  await router.addLiquidity(
    tokenA, tokenB,
    amountA, amountB,
    0, 0, 0, 0,
    ethers.ZeroAddress,
    ethers.MaxUint256
  )
}


////////////////////////////////////////////////////////////////////////////
// f-asset conversions

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

////////////////////////////////////////////////////////////////////////////
// bigint extensions

export type bigintish = bigint | number | string

// not really uniformly random, but it'll do
export function randBigInt(min: bigint, max: bigint): bigint {
  const diff = max - min
  const bitlen = diff.toString(2).length
  const bytelen = Math.ceil(bitlen / 8)
  const randbytes = BigInt("0x" + crypto.randomBytes(bytelen).toString('hex'))
  return min + randbytes % diff
}

export function randBigIntInRadius (center: bigint, radius: bigint): bigint {
  const min = center - radius
  const max = center + radius
  return randBigInt(min, max)
}

export function randBigIntInRelRadius (center: bigint, radiusPerc: number): bigint {
  const radius = center * BigInt(radiusPerc) / BigInt(100)
  return randBigIntInRadius(center, radius)
}