import { BlazeSwapRouterInstance } from '../typechain-truffle/blazeswap/contracts/periphery/BlazeSwapRouter'
import { ERC20MockInstance } from '../typechain-truffle/contracts/mock/ERC20Mock'
import { XRP, USDT, WNAT } from './fixtures/assets'
import { MAX_INT, ZERO_ADDRESS } from './fixtures/constants'
import { swapOutput, assertBnEqual, toBN } from './helpers/utils'

const ERC20Mock = artifacts.require("ERC20Mock")
const BlazeSwapManager = artifacts.require("BlazeSwapManager")
const BlazeSwapFactory = artifacts.require("BlazeSwapBaseFactory")
const BlazeSwapRouter = artifacts.require("BlazeSwapRouter")

contract("Tests for BlazeSwapRouter contract", (accounts) => {
  let wNat: ERC20MockInstance
  let blazeSwapRouter: BlazeSwapRouterInstance
  let tokenA: ERC20MockInstance
  let tokenB: ERC20MockInstance

  before(async function () {
    wNat = await ERC20Mock.new(WNAT.name, WNAT.symbol, WNAT.decimals)
    const blazeSwapManager = await BlazeSwapManager.new(accounts[0])
    const blazeSwapFactory = await BlazeSwapFactory.new(blazeSwapManager.address)
    await blazeSwapManager.setFactory(blazeSwapFactory.address)
    blazeSwapRouter = await BlazeSwapRouter.new(blazeSwapFactory.address, wNat.address, true)
    // set tokens
    tokenA = await ERC20Mock.new(USDT.name, USDT.symbol, USDT.decimals)
    tokenB = await ERC20Mock.new(XRP.name, XRP.symbol, XRP.decimals)
  })

  it("should test adding liquidity", async () => {
    const tokenALiq = toBN(10).pow(toBN(18))
    const tokenBLiq = toBN(2).mul(toBN(10).pow(toBN(6)))
    await tokenA.mint(accounts[0], tokenALiq)
    await tokenB.mint(accounts[0], tokenBLiq)
    await tokenA.approve(blazeSwapRouter.address, tokenALiq)
    await tokenB.approve(blazeSwapRouter.address, tokenBLiq)
    await blazeSwapRouter.addLiquidity(
      tokenA.address, tokenB.address,
      tokenALiq, tokenBLiq, 0, 0, 0, 0,
      ZERO_ADDRESS, MAX_INT
    )
    const { 0: reserveA, 1: reserveB } = await blazeSwapRouter.getReserves(tokenA.address, tokenB.address)
    assertBnEqual(reserveA, tokenALiq)
    assertBnEqual(reserveB, tokenBLiq)
  })

  it("should swap", async () => {
    const swapA = toBN(10).pow(toBN(14))
    await tokenA.mint(accounts[1], swapA)
    await tokenA.approve(blazeSwapRouter.address, swapA, { from: accounts[1] })
    const expectedB = await swapOutput(blazeSwapRouter, tokenA, tokenB, swapA)
    await blazeSwapRouter.swapExactTokensForTokens(
      swapA, 0, [tokenA.address, tokenB.address], accounts[1], MAX_INT, { from: accounts[1] }
    )
    assertBnEqual(await tokenB.balanceOf(accounts[1]), expectedB)
  })

})