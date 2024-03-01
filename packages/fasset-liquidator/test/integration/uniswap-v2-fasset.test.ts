/**
 * This test is run to check whether the dexes are set up correctly from multiple funded addresses
 * The first `it` can then be run on the real network to establish the dex, though cli is preferred.
 * It is basically testing the `setOrUpdateDexes` function.
 * yarn hardhat node --fork-block-number 11484960 --fork https://coston-api.flare.network/ext/C/rpc
 */

import "dotenv/config"
import { parseUnits, MaxUint256, WeiPerEther, Wallet, JsonRpcProvider } from 'ethers'
import { assert } from 'chai'
import { waitFinalize } from './utils/finalization'
import { setOrUpdateDexes } from "./utils/coston-beta/coston"
import { swapDexPairToPrice } from "./utils/uniswap-v2/price-sync"
import { removeLiquidity, swap } from "./utils/uniswap-v2/wrappers"
import { getContracts } from './utils/contracts'
import type { Contracts } from './utils/interfaces/contracts'


const provider = new JsonRpcProvider("http://127.0.0.1:8545/")

// asset manager address for FtestXRP
const ASSET_MANAGER = "0xEB9900EB5fB4eC73EF177e1904f80F1F589D9d5f"
// two accounts funded with FtestXRP and CFLR
const SIGNER_PRIVATE_KEY = process.env.DEX_SIGNER_PRIVATE_KEY!

describe("Uniswap V2 Price Synchronization", () => {
  let contracts: Contracts
  let signer: Wallet

  function formatRelativeRatio(mul: bigint, div: bigint): bigint {
    return (div > BigInt(0)) ? BigInt(100) * (div - mul) / div : BigInt(0)
  }

  async function getBalances(account: Wallet): Promise<[bigint, bigint, bigint]> {
    const fAsset = await contracts.fAsset.balanceOf(account.address)
    const usdc = await contracts.collaterals.usdc.balanceOf(account.address)
    const wNat = await contracts.wNat.balanceOf(account.address)
    return [fAsset, usdc, wNat]
  }

  async function getDexPrices(): Promise<[bigint, bigint]> {
    const [dex1FAsset, dex1Usdc] = await contracts.uniswapV2.getReserves(contracts.fAsset, contracts.collaterals.usdc)
    const [dex2WNat, dex2Usdc] = await contracts.uniswapV2.getReserves(contracts.wNat, contracts.collaterals.usdc)
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
    signer = new Wallet(SIGNER_PRIVATE_KEY, provider)
    // get contracts
    contracts = await getContracts(ASSET_MANAGER, "coston", provider)
    // mint USDC to funded accounts and wrap their CFLR (they will provide liquidity to dexes)
    const availableWNat1 = await provider.getBalance(signer) - WeiPerEther
    await waitFinalize(provider, signer, contracts.wNat.connect(signer).deposit({ value: availableWNat1 })) // wrap CFLR
  })

  // this test should be run before setting up the dex ecosystem. Needed when testing F-Asset system on Coston
  // it is basically testing the `setOrUpdateDexes` function
  it("should use one or two accounts' funds to liquidate dexes to match the ftso price", async () => {
    let initialReservesDex1 = [BigInt(0), BigInt(0)]
    let initialReservesDex2 = [BigInt(0), BigInt(0)]
    try { initialReservesDex1 = await contracts.uniswapV2.getReserves(contracts.fAsset, contracts.collaterals.usdc) } catch {}
    try { initialReservesDex2 = await contracts.uniswapV2.getReserves(contracts.wNat, contracts.collaterals.usdc) } catch {}
    console.log("initial reserves on dex1:", initialReservesDex1)
    console.log("initial reserves on dex2:", initialReservesDex2)
    // get user balances before
    const [fAsset1Before, usdc1Before, wNat1Before] = await getBalances(signer)
    // get ftso prices of all relevant symbols
    const [dex1ExpectedPriceBips, dex2ExpectedPriceBips] = await getFtsoPrices()
    // add liquidity from the primary source if they have funds
    console.log("syncing dex reserves with ftso prices from funded account 1")
    await setOrUpdateDexes(contracts, signer, provider, false)
    // check that dex reserves are aligned with ftso prices
    const [dex1Price, dex2Price] = await getDexPrices()
    assert.equal(dex1Price, dex1ExpectedPriceBips)
    assert.equal(dex2Price, dex2ExpectedPriceBips)
    // get balances after
    const [fAsset1After, usdc1After, wNat1After] = await getBalances(signer)
    // output ratio of each asset spent (scarcely funded assets should have a high percentages)
    const fAsset1SpentPerc = formatRelativeRatio(fAsset1After, fAsset1Before)
    const usdc1SpentPerc = formatRelativeRatio(usdc1After, usdc1Before)
    const wNat1SpentPerc = formatRelativeRatio(wNat1After, wNat1Before)
    console.log('signer fAsset spent:', `${Number(fAsset1SpentPerc)}%`)
    console.log('signer usdc spent:  ', `${Number(usdc1SpentPerc)}%`)
    console.log('signer wNat spent:  ', `${Number(wNat1SpentPerc)}%`)
    // remove liquidity from dexes from signer
    console.log("removing funded account 1 liquidity")
    await removeLiquidity(contracts.uniswapV2, contracts.fAsset, contracts.collaterals.usdc, signer, provider)
    await removeLiquidity(contracts.uniswapV2, contracts.collaterals.usdc, contracts.wNat, signer, provider)
    // check that funded signer had funds returned
    const [fAsset1AfterDrain, usdc1AfterDrain, wNat1AfterDrain] = await getBalances(signer)
    assert.equal(fAsset1AfterDrain, fAsset1Before)
    assert.equal(usdc1AfterDrain, usdc1Before)
    assert.equal(wNat1AfterDrain, wNat1Before)
  })

  // for this test signer should have 1 UDSC
  it("should fix the dex / ftso price discrepancy", async () => {
    const [dex1Price1,] = await getDexPrices()
    // someone makes the transaction that raises dex price through slippage
    const usdcDecimals = await contracts.collaterals.usdc.decimals()
    const swapAmount = parseUnits("1", usdcDecimals)
    console.log("swapping some WFLR for USDC to disrupt the price")
    await swap(contracts.uniswapV2, contracts.collaterals.usdc, contracts.wNat, swapAmount, signer, provider)
    // check that price has changed
    const [dex1Price2,] = await getDexPrices()
    assert.notEqual(dex1Price1, dex1Price2)
    // get ftso prices of all relevant symbols
    const { 0: priceXrp } = await contracts.priceReader.getPrice("testXRP")
    const { 0: priceUsdc } = await contracts.priceReader.getPrice("testUSDC")
    // swap to fix the discrepancy
    console.log("swapping USDC for FtestXRP to fix the price")
    await swapDexPairToPrice(
      contracts,
      contracts.fAsset, contracts.collaterals.usdc,
      priceXrp,
      priceUsdc,
      MaxUint256,
      MaxUint256,
      signer,
      provider
    )
    // check that price has reset
    const [dex1Price3,] = await getDexPrices()
    assert.equal(dex1Price3, dex1Price1)
  })

})