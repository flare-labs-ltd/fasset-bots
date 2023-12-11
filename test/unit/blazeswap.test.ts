import { ethers } from 'hardhat'
import { expect } from 'chai'
import { XRP, USDT, WFLR } from './fixtures/assets'
import { getFactories } from './fixtures/context'
import { priceAB, swapToDexPrice } from '../calculations'
import type { HardhatEthersSigner } from '@nomicfoundation/hardhat-ethers/signers'
import type { BlazeSwapRouter, ERC20Mock } from '../../types'


describe("Tests for BlazeSwapRouter contract", () => {
  let accounts: HardhatEthersSigner[]
  let signer: HardhatEthersSigner
  let wNat: ERC20Mock
  let blazeSwapRouter: BlazeSwapRouter
  let tokenA: ERC20Mock
  let tokenB: ERC20Mock

  async function addLiquidity(amountA: bigint, amountB: bigint) {
    // add liquidity
    await tokenA.mint(accounts[0], amountA)
    await tokenB.mint(accounts[0], amountB)
    await tokenA.approve(blazeSwapRouter, amountA)
    await tokenB.approve(blazeSwapRouter, amountB)
    await blazeSwapRouter.addLiquidity(
      tokenA, tokenB,
      amountA, amountB,
      0, 0, 0, 0,
      accounts[0],
      ethers.MaxUint256
    )
    const { 0: reserveA, 1: reserveB } = await blazeSwapRouter.getReserves(tokenA, tokenB)
    expect(reserveA).to.equal(amountA)
    expect(reserveB).to.equal(amountB)
  }

  // swap on dexes to achieve the given price
  async function swapToPrice(
    priceA: bigint,
    priceB: bigint,
    maxSwapA: bigint,
    maxSwapB: bigint,
  ): Promise<void> {
    const decimalsA = await tokenA.decimals()
    const decimalsB = await tokenB.decimals()
    const [reserveA, reserveB] = await blazeSwapRouter.getReserves(tokenA, tokenB)
    const swapA = swapToDexPrice(reserveA, reserveB, priceA, priceB, decimalsA, decimalsB, maxSwapA)
    const swapB = swapToDexPrice(reserveB, reserveA, priceB, priceA, decimalsB, decimalsA, maxSwapB)
    if (swapA > 0) {
      await tokenA.mint(signer, swapA)
      await tokenA.connect(signer).approve(blazeSwapRouter, swapA)
      await blazeSwapRouter.connect(signer).swapExactTokensForTokens(swapA, 0, [tokenA, tokenB], signer, ethers.MaxUint256)
    } else if (swapB > 0) {
      await tokenB.mint(signer, swapB)
      await tokenB.connect(signer).approve(blazeSwapRouter, swapB)
      await blazeSwapRouter.connect(signer).swapExactTokensForTokens(swapB, 0, [tokenB, tokenA], signer, ethers.MaxUint256)
    }
  }

  beforeEach(async function () {
    // signers
    accounts = await ethers.getSigners()
    signer = accounts[10]
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
  })

  it("should test swapping on dexes to achieve given price", async () => {
    const decimalsA = await tokenA.decimals()
    const decimalsB = await tokenB.decimals()
    // add liquidity
    const tokenALiq = BigInt(1_000_000_000) * BigInt(10) ** BigInt(decimalsA)
    const tokenBLiq = BigInt(1_000_000_000) * BigInt(10) ** BigInt(decimalsB)
    await addLiquidity(tokenALiq, tokenBLiq)
    // swap
    const priceA = BigInt(420) // price of FLR in USD5
    const priceB = BigInt(50_000) // price of XRP in USD5
    await swapToPrice(priceA, priceB, ethers.MaxUint256, ethers.MaxUint256)
    // check that reserves produce the right price
    const [reserveA, reserveB] = await blazeSwapRouter.getReserves(tokenA, tokenB)
    const [wPriceA, wPriceB] = priceAB(priceA, priceB, decimalsA, decimalsB)
    const priceBips = BigInt(10_000) * wPriceA / wPriceB
    expect(BigInt(10_000) * reserveB / reserveA).to.be.approximately(priceBips, priceBips / BigInt(100))
    // exchange some dust, to make sure it's close to setup price
    const swapper = accounts[11]
    const amountA = BigInt(10) ** BigInt(decimalsA)
    await tokenA.mint(swapper, amountA)
    await tokenA.connect(swapper).approve(blazeSwapRouter, amountA)
    await blazeSwapRouter.connect(swapper).swapExactTokensForTokens(amountA, 0, [tokenA, tokenB], swapper, ethers.MaxUint256)
    const amountB = await tokenB.balanceOf(swapper.address)
    expect(amountB).to.be.approximately(amountA * wPriceA / wPriceB, 10)
  })

})