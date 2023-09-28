import { ERC20Instance } from '../../typechain-truffle/@openzeppelin/contracts/token/ERC20/ERC20'
import { BlazeSwapRouterInstance } from '../../typechain-truffle/blazeswap/contracts/periphery/BlazeSwapRouter'
import { ERC20MockInstance } from '../../typechain-truffle/contracts/mock/ERC20Mock'
import { ZERO_ADDRESS, MAX_INT } from './constants'
import { BNish, toBN, expBN } from './utils'


////////////////////////////////////////////////////////////////////////////
// blaze swap

// calculates the amount of tokenB received
// when swapping amountA of tokenA
export async function swapOutput(
  router: BlazeSwapRouterInstance,
  tokenIn: ERC20Instance,
  tokenOut: ERC20Instance,
  amountIn: BNish
): Promise<BN> {
  const { 0: reserveIn, 1: reserveOut } = await router.getReserves(tokenIn.address, tokenOut.address)
  const amountInWithFee = toBN(amountIn).muln(997)
  const numerator = amountInWithFee.mul(reserveOut)
  const denominator = reserveIn.muln(1000).add(amountInWithFee)
  return numerator.div(denominator)
}

// calculates the amount of tokenB needed
// to swap to obtain amountA of tokenIn
export async function swapInput(
  router: BlazeSwapRouterInstance,
  tokenIn: ERC20Instance,
  tokenOut: ERC20Instance,
  amountOut: BNish
): Promise<BN> {
  const { 0: reserveIn, 1: reserveOut } = await router.getReserves(tokenIn.address, tokenOut.address)
  const numerator = reserveIn.mul(toBN(amountOut)).muln(1000)
  const denominator = reserveOut.sub(toBN(amountOut)).muln(997)
  return numerator.div(denominator).addn(1)
}

export async function addLiquidity(
  router: BlazeSwapRouterInstance,
  tokenA: ERC20MockInstance,
  tokenB: ERC20MockInstance,
  amountA: BNish,
  amountB: BNish,
  liquidityProvider: string
): Promise<void> {
  await tokenA.mint(liquidityProvider, amountA)
  await tokenB.mint(liquidityProvider, amountB)
  await tokenA.approve(router.address, amountA)
  await tokenB.approve(router.address, amountB)
  await router.addLiquidity(
    tokenA.address, tokenB.address,
    amountA, amountB, 0, 0, 0, 0,
    ZERO_ADDRESS, MAX_INT
  )
}

////////////////////////////////////////////////////////////////////////////
// implicit ecosystem setters

// get tokenA/tokenB reserve, based on
// the prices that they should have and
// tokenB/tokenA reserve
// prices should be in the same currency,
// e.g. FLR/$, XRP/$
export function priceBasedDexReserve(
  priceA: BNish,
  priceB: BNish,
  decimalsA: BNish,
  decimalsB: BNish,
  reserveA: BNish,
): BN {
  // reserveB / reserveA = priceA / priceB
  return toBN(reserveA)
    .mul(toBN(priceA))
    .mul(expBN(decimalsB))
    .div(expBN(decimalsA))
    .div(toBN(priceB))
}

// prices are in some same currency
export function collateralForCr(
  crBips: BNish,
  totalMintedUBA: BNish,
  priceFAsset: BNish,
  priceCollateral: BNish,
  decimalsFAsset: BNish,
  decimalsCollateral: BNish
): BN {
  return toBN(totalMintedUBA)
    .mul(toBN(priceFAsset))
    .mul(expBN(decimalsCollateral))
    .mul(toBN(crBips))
    .div(toBN(priceCollateral))
    .div(expBN(decimalsFAsset))
    .divn(10_000)
}