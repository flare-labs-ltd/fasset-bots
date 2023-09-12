import { BlazeSwapRouterInstance } from '../../typechain-truffle/blazeswap/contracts/periphery/BlazeSwapRouter'
import { ERC20MockInstance } from '../../typechain-truffle/contracts/mock/ERC20Mock'
import { ZERO_ADDRESS, MAX_INT, BNish, toBN } from './constants'


// calculates the amount of tokenB received
// when swapping amountA of tokenA
export async function swapOutput(
  router: BlazeSwapRouterInstance,
  tokenIn: ERC20MockInstance,
  tokenOut: ERC20MockInstance,
  amountIn: BNish
): Promise<BN> {
  const { 0: reserveA, 1: reserveB } = await router.getReserves(tokenIn.address, tokenOut.address)
  const amountInWithFee = toBN(amountIn).muln(997)
  const numerator = amountInWithFee.mul(reserveB)
  const denominator = reserveA.muln(1000).add(amountInWithFee)
  return numerator.div(denominator)
}

// calculates the amount of tokenB needed
// to swap to obtain amountA of tokenIn
export async function swapInput(
  router: BlazeSwapRouterInstance,
  tokenIn: ERC20MockInstance,
  tokenOut: ERC20MockInstance,
  amountOut: BNish
): Promise<BN> {
  const { 0: reserveA, 1: reserveB } = await router.getReserves(tokenIn.address, tokenOut.address)
  const numerator = reserveA.mul(toBN(amountOut)).muln(1000)
  const denominator = reserveB.sub(toBN(amountOut)).muln(997)
  return numerator.div(denominator).addn(1)
}

// set price of tokenA in tokenB
// prices expressed in e.g. usd
export async function setDexPairPrice(
  router: BlazeSwapRouterInstance,
  tokenA: ERC20MockInstance,
  tokenB: ERC20MockInstance,
  priceA: BNish,
  priceB: BNish,
  reserveA: BNish,
  liquidityProvider: string
): Promise<void> {
  // reserveA / reserveB = priceA / priceB
  const reserveB = toBN(reserveA).mul(toBN(priceB)).div(toBN(priceA))
  await tokenA.mint(liquidityProvider, reserveA)
  await tokenB.mint(liquidityProvider, reserveB)
  await tokenA.approve(router.address, reserveA)
  await tokenB.approve(router.address, reserveB)
  await router.addLiquidity(
    tokenA.address, tokenB.address,
    reserveA, reserveB, 0, 0, 0, 0,
    ZERO_ADDRESS, MAX_INT
  )
}