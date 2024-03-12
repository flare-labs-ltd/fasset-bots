/**
 * This test is run to check whether the dexes are set up correctly from multiple funded addresses
 * It is basically testing the `setOrUpdateDexes` function.
 * yarn hardhat node --fork-block-number 11484960 --fork https://coston-api.flare.network/ext/C/rpc
 */

import "dotenv/config"
import { expect } from "chai"
import { JsonRpcProvider, Wallet, WeiPerEther } from 'ethers'
import { optimalAddedLiquidity, swapOutput, liquidityOut } from "../calculations/calculations"
import { getBaseContracts } from './utils/contracts'
import { waitFinalize } from './utils/finalization'
import { addLiquidity, getPairFor, removeLiquidity, safelyGetReserves, swap } from "./utils/uniswap-v2/wrappers"
import type { IERC20Metadata } from "../../types"
import type { BaseContracts } from './utils/interfaces/contracts'


const provider = new JsonRpcProvider("http://127.0.0.1:8545/")

// two accounts funded with FtestXRP and CFLR
const SIGNER_PRIVATE_KEY = process.env.DEX_SIGNER_PRIVATE_KEY!

describe("Uniswap V2 manipulation", () => {
  let contracts: BaseContracts
  let signer: Wallet
  let tokenA: IERC20Metadata
  let tokenB: IERC20Metadata

  before(async () => {
    // get relevant signers
    signer = new Wallet(SIGNER_PRIVATE_KEY, provider)
    // get contracts
    contracts = getBaseContracts("coston", provider)
    tokenA = contracts.collaterals.USDC
    tokenB = contracts.wNat
    // if tokenA != wNat then comment this out
    const availableWNat1 = await provider.getBalance(signer) - WeiPerEther
    await waitFinalize(provider, signer, contracts.wNat.connect(signer).deposit({ value: availableWNat1 })) // wrap CFLR
  })

  it("should add liquidity", async () => {
    // choose amount of liquidity to add
    const oldBalanceA = await tokenA.balanceOf(signer)
    const oldBalanceB = await tokenB.balanceOf(signer)
    const maxInvestedA = oldBalanceA / BigInt(2)
    const maxInvestedB = oldBalanceB / BigInt(2)
    // add liquidity
    const [oldReserveA, oldReserveB] = await safelyGetReserves(contracts.uniswapV2, tokenA, tokenB)
    await addLiquidity(contracts.uniswapV2, tokenA, tokenB, maxInvestedA, maxInvestedB, signer, provider)
    const { 0: newReserveA, 1: newReserveB } = await contracts.uniswapV2.getReserves(tokenA, tokenB)
    // check that everything went well
    const [investedA, investedB] = (oldReserveA > BigInt(0) && oldReserveB > BigInt(0))
        ? optimalAddedLiquidity(oldReserveA, oldReserveB, maxInvestedA, maxInvestedB)
        : [maxInvestedA, maxInvestedB]
    expect(newReserveA - oldReserveA).to.equal(investedA)
    expect(newReserveB - oldReserveB).to.equal(investedB)
    const newBalanceA = await tokenA.balanceOf(signer)
    const newBalanceB = await tokenB.balanceOf(signer)
    expect(oldBalanceA - newBalanceA).to.equal(investedA)
    expect(oldBalanceB - newBalanceB).to.equal(investedB)
  })

  it("should swap", async () => {
    // choose amount to swap
    const oldBalanceA = await tokenA.balanceOf(signer)
    const oldBalanceB = await tokenB.balanceOf(signer)
    const swapA = oldBalanceA / BigInt(10)
    // swap
    const { 0: oldReserveA, 1: oldReserveB } = await contracts.uniswapV2.getReserves(tokenA, tokenB)
    await swap(contracts.uniswapV2, tokenA, tokenB, swapA, signer, provider)
    const { 0: newReserveA, 1: newReserveB } = await contracts.uniswapV2.getReserves(tokenA, tokenB)
    // check that everything went well
    const expectedSwapB = swapOutput(swapA, oldReserveA, oldReserveB)
    expect(newReserveA).to.equal(oldReserveA + swapA)
    expect(newReserveB).to.equal(oldReserveB - expectedSwapB)
    const newBalanceA = await tokenA.balanceOf(signer)
    const newBalanceB = await tokenB.balanceOf(signer)
    expect(newBalanceA).to.equal(oldBalanceA - swapA)
    expect(newBalanceB).to.equal(oldBalanceB + expectedSwapB)
  })

  it("should remove liquidity", async () => {
    // remove all liquidity
    const oldBalanceA = await tokenA.balanceOf(signer)
    const oldBalanceB = await tokenB.balanceOf(signer)
    const pair = await getPairFor(contracts.uniswapV2, tokenA, tokenB, provider)
    const liquidity = await pair.balanceOf(signer)
    const totalLiquidity = await pair.totalSupply()
    const { 0: reserveA, 1: reserveB } = await contracts.uniswapV2.getReserves(tokenA, tokenB)
    // remove liquidity
    await removeLiquidity(contracts.uniswapV2, tokenA, tokenB, signer, provider)
    // check that everything went ok
    const expectedObtainedA = liquidityOut(liquidity, totalLiquidity, reserveA)
    const expectedObtainedB = liquidityOut(liquidity, totalLiquidity, reserveB)
    const newBalanceA = await tokenA.balanceOf(signer)
    const newBalanceB = await tokenB.balanceOf(signer)
    expect(newBalanceA).to.equal(oldBalanceA + expectedObtainedA)
    expect(newBalanceB).to.equal(oldBalanceB + expectedObtainedB)
  })

})