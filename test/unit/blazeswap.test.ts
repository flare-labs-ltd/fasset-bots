import { ethers } from 'hardhat'
import { expect } from 'chai'
import { XRP, USDT, WFLR } from './fixtures/assets'
import { swapOutput } from './helpers/utils'
import { getFactories } from './helpers/factories'
import type { BlazeSwapRouter, ERC20Mock } from '../../types'
import type { HardhatEthersSigner } from '@nomicfoundation/hardhat-ethers/signers'


describe("Tests for BlazeSwapRouter contract", () => {
  let accounts: HardhatEthersSigner[]
  let wNat: ERC20Mock
  let blazeSwapRouter: BlazeSwapRouter
  let tokenA: ERC20Mock
  let tokenB: ERC20Mock

  before(async function () {
    accounts = await ethers.getSigners()
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

  it("should test adding liquidity", async () => {
    const tokenALiq = BigInt(10) ** BigInt(18)
    const tokenBLiq = BigInt(2) * BigInt(10) ** BigInt(6)
    await tokenA.mint(accounts[0], tokenALiq)
    await tokenB.mint(accounts[0], tokenBLiq)
    await tokenA.approve(blazeSwapRouter, tokenALiq)
    await tokenB.approve(blazeSwapRouter, tokenBLiq)
    await blazeSwapRouter.addLiquidity(
      tokenA, tokenB,
      tokenALiq, tokenBLiq,
      0, 0, 0, 0,
      ethers.ZeroAddress,
      ethers.MaxUint256
    )
    const { 0: reserveA, 1: reserveB } = await blazeSwapRouter.getReserves(tokenA, tokenB)
    expect(reserveA).to.equal(tokenALiq)
    expect(reserveB).to.equal(tokenBLiq)
  })

  it("should swap", async () => {
    const swapA = BigInt(10) ** BigInt(14)
    await tokenA.mint(accounts[1], swapA)
    await tokenA.connect(accounts[1]).approve(blazeSwapRouter, swapA)
    const expectedB = await swapOutput(blazeSwapRouter, tokenA, tokenB, swapA)
    await blazeSwapRouter.connect(accounts[1]).swapExactTokensForTokens(
      swapA, 0, [tokenA, tokenB], accounts[1], ethers.MaxUint256
    )
    expect(await tokenB.balanceOf(accounts[1])).to.equal(expectedB)
  })

})