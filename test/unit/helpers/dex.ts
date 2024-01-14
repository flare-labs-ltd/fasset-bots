import { ethers } from 'hardhat'
import { swapInput as calcSwapInput, swapOutput as calcSwapOutput } from '../../calculations'
import type { Signer } from 'ethers'
import type { ERC20, BlazeSwapRouter, ERC20Mock } from '../../../types'


export async function addLiquidity(
  router: BlazeSwapRouter,
  tokenA: ERC20Mock,
  tokenB: ERC20Mock,
  amountA: bigint,
  amountB: bigint,
  liquidityProvider: Signer
): Promise<void> {
  // mint because we just want to add liquidity to the pool,
  // are not testing for the effects on liquidity providers
  await tokenA.mint(liquidityProvider, amountA)
  await tokenB.mint(liquidityProvider, amountB)
  await tokenA.connect(liquidityProvider).approve(router, amountA)
  await tokenB.connect(liquidityProvider).approve(router, amountB)
  await router.connect(liquidityProvider).addLiquidity(
    tokenA, tokenB,
    amountA, amountB,
    0, 0, 0, 0,
    liquidityProvider,
    ethers.MaxUint256
  )
}

// calculates the amount received when swapping amountA through path
export async function swapOutput(
  router: BlazeSwapRouter,
  path: ERC20[],
  amountA: bigint
): Promise<bigint> {
  let amountB = amountA
  for (let i = 1; i < path.length; i++) {
    const { 0: reserveA, 1: reserveB } = await router.getReserves(path[i-1], path[i])
    amountB = calcSwapOutput(amountB, reserveA, reserveB)
  }
  return amountB
}

// calculates the amount of input needed to swap to amountB through path
export async function swapInput(
  router: BlazeSwapRouter,
  path: ERC20[],
  amountB: bigint
): Promise<bigint> {
  let amountA = amountB
  for (let i = path.length - 1; i > 0; i--) {
    const { 0: reserveA, 1: reserveB } = await router.getReserves(path[i-1], path[i])
    amountA = calcSwapInput(amountA, reserveA, reserveB)
  }
  return amountA
}

export async function swap(
  router: BlazeSwapRouter,
  tokenPath: ERC20Mock[],
  amountA: bigint,
  swapper: Signer
  ): Promise<void> {
    await tokenPath[0].connect(swapper).approve(router, amountA)
  await router.connect(swapper).swapExactTokensForTokens(amountA, 0, tokenPath, swapper, ethers.MaxUint256)
}

async function serializeTokenPair(tokenA: ERC20, tokenB: ERC20): Promise<string> {
  const nameA = await tokenA.name()
  const nameB = await tokenB.name()
  return (nameA < nameB) ? nameA + nameB : nameB + nameA
}

// needed if a swap affects the reserves of a pair used in a subsequent swap
export async function swapOutputs(
  router: BlazeSwapRouter,
  paths: ERC20[][],
  amountsA: bigint[]
): Promise<bigint[]> {
  // store reserves
  const reserves = new Map<string, Map<ERC20, bigint>>()
  for (let i = 0; i < paths.length; i++) {
    const path = paths[i]
    for (let j = 1; j < path.length; j++) {
      const tokenA = path[j-1]
      const tokenB = path[j]
      const pairKey = await serializeTokenPair(tokenA, tokenB)
      if (reserves.get(pairKey) === undefined) {
        const pairReserves = new Map<ERC20, bigint>()
        const { 0: reserveA, 1: reserveB } = await router.getReserves(tokenA, tokenB)
        pairReserves.set(tokenA, reserveA)
        pairReserves.set(tokenB, reserveB)
        reserves.set(pairKey, pairReserves)
      }
    }
  }
  // calc output
  let amountsB = amountsA.slice()
  for (let i = 0; i < paths.length; i++) {
    const path = paths[i]
    for (let j = 1; j < path.length; j++) {
      const tokenA = path[j-1]
      const tokenB = path[j]
      const pairKey = await serializeTokenPair(tokenA, tokenB)
      const pairReserves = reserves.get(pairKey)!
      const reserveA = pairReserves.get(tokenA)!
      const reserveB = pairReserves.get(tokenB)!
      pairReserves.set(tokenA, reserveA + amountsB[i])
      amountsB[i] = calcSwapOutput(amountsB[i], reserveA, reserveB)
      pairReserves.set(tokenB, reserveB - amountsB[i])
    }
  }
  return amountsB
}