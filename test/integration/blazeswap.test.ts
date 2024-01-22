/**
 * This test is run to check whether the dexes are set up correctly from multiple funded addresses
 * yarn hardhat node --fork-block-number 11484960 --fork https://coston-api.flare.network/ext/C/rpc
 */

import "dotenv/config"
import { ethers } from 'ethers'
import { assert } from 'chai'
import { waitFinalize, syncDexReservesWithFtsoPrices, removeLiquidity, swap, swapDexPairToPrice } from './helpers/utils'
import { getContracts } from './helpers/contracts'
import type { Contracts } from './helpers/interface'

const provider = new ethers.JsonRpcProvider("http://127.0.0.1:8545/")

// asset manager address for FtestXRP
const ASSET_MANAGER = "0xEB9900EB5fB4eC73EF177e1904f80F1F589D9d5f"
// two accounts funded with FtestXRP and CFLR
const FUNDED_PVK_1 = process.env.FUND_SUPPLIER_PRIVATE_KEY_1!
const FUNDED_PVK_2 = process.env.FUND_SUPPLIER_PRIVATE_KEY_2

describe("Ecosystem setup", () => {
  let contracts: Contracts
  let funded1: ethers.Wallet // primary source of funds - needed for all tests
  let funded2: ethers.Wallet // secondary source of funds - for additional tests

  function formatRelativeRatio(mul: bigint, div: bigint): bigint {
    return (div > BigInt(0)) ? BigInt(100) * (div - mul) / div : BigInt(0)
  }

  async function getBalances(account: ethers.Wallet): Promise<[bigint, bigint, bigint]> {
    const fAsset = await contracts.fAsset.balanceOf(account.address)
    const usdc = await contracts.usdc.balanceOf(account.address)
    const wNat = await contracts.wNat.balanceOf(account.address)
    return [fAsset, usdc, wNat]
  }

  async function getDexPrices(): Promise<[bigint, bigint]> {
    const [dex1FAsset, dex1Usdc] = await contracts.uniswapV2.getReserves(contracts.fAsset, contracts.usdc)
    const [dex2WNat, dex2Usdc] = await contracts.uniswapV2.getReserves(contracts.wNat, contracts.usdc)
    const dex1Price = BigInt(10_000) * dex1FAsset * BigInt(1e12) / dex1Usdc
    const dex2Price = BigInt(10_000) * dex2Usdc / dex2WNat
    return [dex1Price, dex2Price]
  }

  async function getFtsoPrices(): Promise<[bigint, bigint]> {
    // get ftso prices of all relevant symbols
    const { 0: usdcPrice } = await contracts.priceReader.getPrice("testUSDC")
    const { 0: wNatPrice } = await contracts.priceReader.getPrice("CFLR")
    const { 0: assetPrice } = await contracts.priceReader.getPrice("testXRP")
    // we expect such prices after setting up the dex
    const dex1ExpectedPriceBips = BigInt(10_000) * usdcPrice / assetPrice
    const dex2ExpectedPriceBips = BigInt(10_000) * wNatPrice / usdcPrice
    return [dex1ExpectedPriceBips, dex2ExpectedPriceBips]
  }

  before(async () => {
    // get relevant signers
    funded1 = new ethers.Wallet(FUNDED_PVK_1, provider)
    funded2 = new ethers.Wallet(FUNDED_PVK_2 ?? ethers.ZeroAddress, provider)
    // get contracts
    contracts = await getContracts(ASSET_MANAGER, "coston", provider)
    // mint USDC to funded accounts and wrap their CFLR (they will provide liquidity to dexes)
    const availableWNat1 = await provider.getBalance(funded1) - ethers.WeiPerEther
    const availableWNat2 = await provider.getBalance(funded2) - ethers.WeiPerEther
    await waitFinalize(provider, funded1, contracts.wNat.connect(funded1).deposit({ value: availableWNat1 })) // wrap CFLR
    await waitFinalize(provider, funded2, contracts.wNat.connect(funded2).deposit({ value: availableWNat2 })) // wrap CFLR
  })

  // this test should be run before setting up the dex ecosystem. Needed when testing F-Asset system on Coston
  // it is basically testing the `syncDeXReservesWithFtsoPrices` function
  it("should use one or two accounts' funds to liquidate dexes to match the ftso price", async () => {
    try {
      const initialReservesDex1 = await contracts.uniswapV2.getReserves(contracts.fAsset, contracts.usdc)
      console.log("initial reserves on dex1:", initialReservesDex1 ?? 'none')
      const initialReservesDex2 = await contracts.uniswapV2.getReserves(contracts.wNat, contracts.usdc)
      console.log("initial reserves on dex2:", initialReservesDex2 ?? 'none')
    } catch {}
    // get user balances before
    const [fAsset1Before, usdc1Before, wNat1Before] = await getBalances(funded1)
    const [fAsset2Before, usdc2Before, wNat2Before] = await getBalances(funded2)
    // get ftso prices of all relevant symbols
    const [dex1ExpectedPriceBips, dex2ExpectedPriceBips] = await getFtsoPrices()
    // add liquidity from the primary source if they have funds
    await syncDexReservesWithFtsoPrices(contracts, funded1, provider, false)
    // check that dex reserves are aligned with ftso prices
    const [dex1Price, dex2Price] = await getDexPrices()
    assert.equal(dex1Price, dex1ExpectedPriceBips)
    assert.equal(dex2Price, dex2ExpectedPriceBips)
    // add liquidity from the secondary source if they have funds (depends on the test)
    if (fAsset2Before > BigInt(0) && usdc2Before > BigInt(0) && wNat2Before > BigInt(0)) {
      await syncDexReservesWithFtsoPrices(contracts, funded2, provider, false)
      // check that dex reserves are aligned with ftso prices
      const [dex1Price, dex2Price] = await getDexPrices()
      assert.equal(dex1Price, dex1ExpectedPriceBips)
      assert.equal(dex2Price, dex2ExpectedPriceBips)
    }
    // get balances after
    const [fAsset1After, usdc1After, wNat1After] = await getBalances(funded1)
    const [fAsset2After, usdc2After, wNat2After] = await getBalances(funded2)
    // output ratio of each asset spent (scarcely funded assets should have a high percentages)
    const fAsset1SpentPerc = formatRelativeRatio(fAsset1After, fAsset1Before)
    const usdc1SpentPerc = formatRelativeRatio(usdc1After, usdc1Before)
    const wNat1SpentPerc = formatRelativeRatio(wNat1After, wNat1Before)
    console.log('fAsset1 spent:', `${Number(fAsset1SpentPerc)}%`)
    console.log('usdc1 spent:  ', `${Number(usdc1SpentPerc)}%`)
    console.log('wNat1 spent:  ', `${Number(wNat1SpentPerc)}%`)
    const fAsset2SpentPerc = formatRelativeRatio(fAsset2After, fAsset2Before)
    const usdc2SpentPerc = formatRelativeRatio(usdc2After, usdc2Before)
    const wNat2SpentPerc = formatRelativeRatio(wNat2After, wNat2Before)
    console.log('fAsset2 spent:', `${Number(fAsset2SpentPerc)}%`)
    console.log('usdc2 spent:  ', `${Number(usdc2SpentPerc)}%`)
    console.log('wNat2 spent:  ', `${Number(wNat2SpentPerc)}%`)
    // remove liquidity from dexes from funded account 1
    await removeLiquidity(contracts.uniswapV2, contracts.dex1Token, contracts.fAsset, contracts.usdc, funded1, provider)
    await removeLiquidity(contracts.uniswapV2, contracts.dex2Token, contracts.usdc, contracts.wNat, funded1, provider)
    // remove liquidity from dexes from funded account 2
    await removeLiquidity(contracts.uniswapV2, contracts.dex1Token, contracts.fAsset, contracts.usdc, funded2, provider)
    await removeLiquidity(contracts.uniswapV2, contracts.dex2Token, contracts.usdc, contracts.wNat, funded2, provider)
    // check that funded account 1 had funds returned
    const [fAsset1AfterDrain, usdc1AfterDrain, wNat1AfterDrain] = await getBalances(funded1)
    assert.equal(fAsset1AfterDrain, fAsset1Before)
    assert.equal(usdc1AfterDrain, usdc1Before)
    assert.equal(wNat1AfterDrain, wNat1Before)
    // check that funded account 2 had funds returned
    const [fAsset2AfterDrain, usdc2AfterDrain, wNat2AfterDrain] = await getBalances(funded2)
    assert.equal(fAsset2AfterDrain, fAsset2Before)
    assert.equal(usdc2AfterDrain, usdc2Before)
    assert.equal(wNat2AfterDrain, wNat2Before)
  })

  // for this test funded1 should have 1 FtestXRP
  it("should fix the dex / ftso price discrepancy", async () => {
    const [dex1Price1,] = await getDexPrices()
    // someone makes the transaction that raises dex price through slippage
    const swapAmount = ethers.parseEther("1")
    await swap(contracts.uniswapV2, contracts.fAsset, contracts.usdc, swapAmount, funded1, provider)
    // check that price has changed
    const [dex1Price2,] = await getDexPrices()
    assert.notEqual(dex1Price1, dex1Price2)
    // get ftso prices of all relevant symbols
    const { 0: priceXrp } = await contracts.priceReader.getPrice("testXRP")
    const { 0: priceUsdc } = await contracts.priceReader.getPrice("testUSDC")
    // swap to fix the discrepancy
    await swapDexPairToPrice(
      contracts,
      contracts.fAsset, contracts.usdc,
      priceXrp, priceUsdc,
      ethers.MaxUint256,
      ethers.MaxUint256,
      funded1, provider
    )
    // check that price has reset
    const [dex1Price3,] = await getDexPrices()
    assert.equal(dex1Price3, dex1Price1)
  })
})