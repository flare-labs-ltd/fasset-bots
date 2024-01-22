import { ethers } from 'hardhat'
import {
  swapInput as calcSwapInput,
  swapOutput as calcSwapOutput,
  swapOutputs as calcSwapOutputs
} from '../../calculations'
import type { Signer } from 'ethers'
import type { ERC20, ERC20Mock, IUniswapV2Router } from '../../../types'


export async function addLiquidity(
  router: IUniswapV2Router,
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
  router: IUniswapV2Router,
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
  router: IUniswapV2Router,
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
  router: IUniswapV2Router,
  tokenPath: ERC20Mock[],
  amountA: bigint,
  swapper: Signer
  ): Promise<void> {
    await tokenPath[0].connect(swapper).approve(router, amountA)
  await router.connect(swapper).swapExactTokensForTokens(amountA, 0, tokenPath, swapper, ethers.MaxUint256)
}

// needed if a swap affects the reserves of a pair used in a subsequent swap
export async function swapOutputs(
  router: IUniswapV2Router,
  paths: ERC20[][],
  amountsA: bigint[]
): Promise<bigint[]> {
  // store reserves
  const reserves = []
  for (let i = 0; i < paths.length; i++) {
    const reserve = []
    for (let j = 1; j < paths[i].length; j++) {
      const { 0: reserveA, 1: reserveB } = await router.getReserves(paths[i][j-1], paths[i][j])
      reserve.push([reserveA, reserveB] as [bigint, bigint])
    }
    reserves.push(reserve)
  }
  const namePaths = await Promise.all(paths.map(async path =>
    await Promise.all(path.map(async token => await token.name()))
  ))
  return calcSwapOutputs(amountsA, namePaths, reserves)
}