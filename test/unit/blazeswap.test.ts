import { ethers } from 'hardhat'
import { expect } from 'chai'
import { XRP, USDT, WFLR } from './fixtures/assets'
import { getFactories } from './fixtures/context'
import { convertUsd5ToToken, priceAB, swapToDexPrice } from '../calculations'
import { addLiquidity, swap, swapOutput } from './helpers/utils'
import type { HardhatEthersSigner } from '@nomicfoundation/hardhat-ethers/signers'
import type { BlazeSwapRouter, ERC20Mock } from '../../types'


describe("Tests for BlazeSwapRouter contract", () => {
  // default "real" token prices
  const priceTokenAUsd5 = BigInt(100_000) // price of USDT in USD5
  const priceTokenBUsd5 = BigInt(50_000) // price of XRP in USD5
  const priceTokenCUsd5 = BigInt(420) // price of FLR in USD5
  // set before each
  let accounts: HardhatEthersSigner[]
  let signer: HardhatEthersSigner
  let swapper: HardhatEthersSigner
  let wNat: ERC20Mock
  let blazeSwapRouter: BlazeSwapRouter
  let tokenA: ERC20Mock
  let tokenB: ERC20Mock
  let tokenC: ERC20Mock
  let decimalsA: bigint
  let decimalsB: bigint
  let decimalsC: bigint

  async function addInitialLiquidity(): Promise<void> {
    const defaultLiquidityValueUsd5 = BigInt(1_000_000_00000) // $1M
    const tokenALiquidityDex1 = convertUsd5ToToken(defaultLiquidityValueUsd5, decimalsA, priceTokenAUsd5)
    const tokenBLiquidityDex1 = convertUsd5ToToken(defaultLiquidityValueUsd5, decimalsB, priceTokenBUsd5)
    await addLiquidity(blazeSwapRouter, tokenA, tokenB, tokenALiquidityDex1, tokenBLiquidityDex1, signer)
    const tokenBLiquidityDex2 = convertUsd5ToToken(defaultLiquidityValueUsd5, decimalsB, priceTokenBUsd5)
    const tokenCLiquidityDex2 = convertUsd5ToToken(defaultLiquidityValueUsd5, decimalsC, priceTokenCUsd5)
    await addLiquidity(blazeSwapRouter, tokenB, tokenC, tokenBLiquidityDex2, tokenCLiquidityDex2, signer)
  }

  // swap on dexes to achieve the given price
  async function swapToPrice(
    priceA: bigint,
    priceB: bigint,
    maxSwapA: bigint,
    maxSwapB: bigint,
  ): Promise<void> {
    const [reserveA, reserveB] = await blazeSwapRouter.getReserves(tokenA, tokenB)
    const swapA = swapToDexPrice(reserveA, reserveB, priceA, priceB, decimalsA, decimalsB, maxSwapA)
    const swapB = swapToDexPrice(reserveB, reserveA, priceB, priceA, decimalsB, decimalsA, maxSwapB)
    if (swapA > 0) {
      await tokenA.mint(signer, swapA)
      await swap(blazeSwapRouter, [tokenA, tokenB], swapA, signer)
    } else if (swapB > 0) {
      await tokenB.mint(signer, swapB)
      await swap(blazeSwapRouter, [tokenB, tokenA], swapB, signer)
    }
  }

  beforeEach(async function () {
    // signers
    accounts = await ethers.getSigners()
    signer = accounts[10]
    swapper = accounts[11]
    // contracts
    const factories = await getFactories()
    wNat = await factories.pool.deploy(WFLR.name, WFLR.symbol, WFLR.decimals)
    const blazeSwapManager = await factories.blazeSwapManager.deploy(accounts[0])
    const blazeSwapFactory = await factories.blazeSwapFactory.deploy(blazeSwapManager)
    await blazeSwapManager.setFactory(blazeSwapFactory)
    blazeSwapRouter = await factories.blazeSwapRouter.deploy(blazeSwapFactory, wNat, true)
    // set tokens
    tokenA = await factories.vault.deploy(USDT.name, USDT.symbol, USDT.decimals)
    tokenB = await factories.fAsset.deploy(XRP.name, XRP.symbol, XRP.decimals)
    tokenC = await factories.vault.deploy(WFLR.name, WFLR.symbol, WFLR.decimals)
    // set decimals for easier access
    decimalsA = await tokenA.decimals()
    decimalsB = await tokenB.decimals()
    decimalsC = await tokenC.decimals()
  })

  it("should test swapping on dexes to achieve given price", async () => {
    // add initial default liquidity
    await addInitialLiquidity()
    // swap
    await swapToPrice(priceTokenAUsd5, priceTokenBUsd5, ethers.MaxUint256, ethers.MaxUint256)
    // check that reserves produce the right price
    const [reserveA, reserveB] = await blazeSwapRouter.getReserves(tokenA, tokenB)
    const [wPriceA, wPriceB] = priceAB(priceTokenAUsd5, priceTokenBUsd5, decimalsA, decimalsB)
    const priceBips = BigInt(10_000) * wPriceA / wPriceB
    const dexPriceBips = BigInt(10_000) * reserveB / reserveA
    expect(dexPriceBips).to.be.approximately(priceBips, priceBips / BigInt(1000))
    // exchange some dust, to make sure it's close to setup price
    const amountA = BigInt(10) ** BigInt(decimalsA)
    await tokenA.mint(swapper, amountA)
    await swap(blazeSwapRouter, [tokenA, tokenB], amountA, swapper)
    const amountB = await tokenB.balanceOf(swapper)
    const amountBByPrice = amountA * wPriceA / wPriceB
    const amountBByPriceWithFee = amountBByPrice * BigInt(997) / BigInt(1000)
    expect(amountB).to.be.approximately(amountBByPriceWithFee, 10)
  })

  it("should test swapping with a non-default path", async () => {
    // add initial default liquidity
    await addInitialLiquidity()
    // amount of token A to swap ($0.01)
    const amountA = convertUsd5ToToken(BigInt(100), decimalsA, priceTokenAUsd5)
    // swap from tokenA to tokenC via tokenB
    const expectedOutB = await swapOutput(blazeSwapRouter, [tokenA, tokenB], amountA)
    const expectedOutC = await swapOutput(blazeSwapRouter, [tokenB, tokenC], expectedOutB)
    await tokenA.connect(signer).mint(signer, amountA)
    await swap(blazeSwapRouter, [tokenA, tokenB, tokenC], amountA, signer)
    // check that the minter got the right amount of tokenC
    const amountC = await tokenC.balanceOf(signer)
    expect(amountC).to.equal(expectedOutC)
  })

})