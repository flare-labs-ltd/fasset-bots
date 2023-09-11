import { BlazeSwapRouterInstance } from '../../typechain-truffle/blazeswap/contracts/periphery/BlazeSwapRouter'
import { ERC20MockInstance } from '../../typechain-truffle/contracts/mock/ERC20Mock'
import { ZERO_ADDRESS, MAX_INT, BNish, toBN } from './constants'


// calculates the amount of tokenB received
// when swapping amountA of tokenA
export async function swapOutput(
  router: BlazeSwapRouterInstance,
  tokenA: ERC20MockInstance,
  tokenB: ERC20MockInstance,
  amountA: BNish
): Promise<BN> {
  const { 0: reserveA, 1: reserveB } = await router.getReserves(tokenA.address, tokenB.address)
  const amountAWithFee = toBN(amountA).muln(997).divn(1000)
  return amountAWithFee.mul(reserveB).div(reserveA.add(amountAWithFee))
}

// calculates the amount of tokenB needed
// to swap to obtain amountA of tokenA
export async function swapInput(
  router: BlazeSwapRouterInstance,
  tokenA: ERC20MockInstance,
  tokenB: ERC20MockInstance,
  amountB: BNish
): Promise<BN> {
  const { 0: reserveA, 1: reserveB } = await router.getReserves(tokenA.address, tokenB.address)
  const amountABeforeFee = toBN(amountB).mul(reserveA).div(reserveB.sub(toBN(amountB)))
  return amountABeforeFee.muln(1000).divn(997)
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