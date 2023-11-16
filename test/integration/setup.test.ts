/**
 * This test is run to check whether the dexes are set up correctly from multiple funded addresses
 * yarn hardhat node --fork-block-number 11225480 --fork https://coston-api.flare.network/ext/C/rpc
 */

require('dotenv').config()
import { ethers } from 'ethers'
import { assert } from 'chai'
import { waitFinalize, syncDexReservesWithFtsoPrices } from './helpers/utils'
import { getContracts } from './helpers/contracts'
import type { Contracts } from './helpers/interface'

const provider = new ethers.JsonRpcProvider("http://127.0.0.1:8545/")

// asset manager address for FtestXRP
const ASSET_MANAGER = "0x93CF4820d35Fff1afd44aD54546649D8D2b8e952"
// two accounts funded with FtestXRP and CFLR
const FUNDED_PVK_1 = process.env.FUND_SUPPLIER_PRIVATE_KEY_1!
const FUNDED_PVK_2 = process.env.FUND_SUPPLIER_PRIVATE_KEY_2!

describe("Ecosystem setup", () => {
  let contracts: Contracts
  let funded1: ethers.Wallet
  let funded2: ethers.Wallet

  async function getDexPrices(): Promise<[bigint, bigint]> {
    const [dex1FAsset, dex1Usdc] = await contracts.blazeSwapRouter.getReserves(contracts.fAsset, contracts.usdc)
    const [dex2WNat, dex2Usdc] = await contracts.blazeSwapRouter.getReserves(contracts.wNat, contracts.usdc)
    const dex1Price = BigInt(10_000) * dex1FAsset * BigInt(1e12) / dex1Usdc
    const dex2Price = BigInt(10_000) * dex2Usdc / dex2WNat
    return [dex1Price, dex2Price]
  }

  async function getBalances(account: ethers.Wallet): Promise<[bigint, bigint, bigint]> {
    const fAsset = await contracts.fAsset.balanceOf(account.address)
    const usdc = await contracts.usdc.balanceOf(account.address)
    const wNat = await contracts.wNat.balanceOf(account.address)
    return [fAsset, usdc, wNat]
  }

  beforeEach(async () => {
    // get relevant signers
    funded1 = new ethers.Wallet(FUNDED_PVK_1, provider)
    funded2 = new ethers.Wallet(FUNDED_PVK_2, provider)
    // get contracts
    contracts = await getContracts(ASSET_MANAGER, "coston", provider)
    // mint USDC to funded accounts and wrap their CFLR (they will provide liquidity to dexes)
    const availableWNat1 = await provider.getBalance(funded1) - ethers.WeiPerEther
    const availableWNat2 = await provider.getBalance(funded2) - ethers.WeiPerEther
    await waitFinalize(provider, funded1, contracts.wNat.connect(funded1).deposit({ value: availableWNat1 })) // wrap CFLR
    await waitFinalize(provider, funded2, contracts.wNat.connect(funded2).deposit({ value: availableWNat2 })) // wrap CFLR
  })

  it("should use two accounts' funds to provide liquidity equal to dexes", async () => {
    try {
      const initialReservesDex1 = await contracts.blazeSwapRouter.getReserves(contracts.fAsset, contracts.usdc)
      console.log("initial reserves on dex1:", initialReservesDex1 ?? 'none')
      const initialReservesDex2 = await contracts.blazeSwapRouter.getReserves(contracts.wNat, contracts.usdc)
      console.log("initial reserves on dex2:", initialReservesDex2 ?? 'none')
    } catch {}
    // get user balances before
    const [fAsset1Before, usdc1Before, wNat1Before] = await getBalances(funded1)
    const [fAsset2Before, usdc2Before, wNat2Before] = await getBalances(funded2)
    // get ftso prices of all relevant symbols
    const { 0: usdcPrice } = await contracts.priceReader.getPrice("testUSDC")
    const { 0: wNatPrice } = await contracts.priceReader.getPrice("CFLR")
    const { 0: assetPrice } = await contracts.priceReader.getPrice("testXRP")
    // we expect such prices after setting up the dex
    const dex1ExpectedPriceBips = BigInt(10_000) * usdcPrice / assetPrice
    const dex2ExpectedPriceBips = BigInt(10_000) * wNatPrice / usdcPrice
    // add liquidity from the first source
    await syncDexReservesWithFtsoPrices(contracts, funded1, provider, false)
    // check that dex reserves are aligned with ftso prices
    const [dex1Price, dex2Price] = await getDexPrices()
    assert.equal(dex1Price, dex1ExpectedPriceBips)
    assert.equal(dex2Price, dex2ExpectedPriceBips)
    // add liquidity from another source
    await syncDexReservesWithFtsoPrices(contracts, funded2, provider, false)
    // check that dex reserves are aligned with ftso prices
    const [dex1Price2, dex2Price2] = await getDexPrices()
    assert.equal(dex1Price2, dex1ExpectedPriceBips)
    assert.equal(dex2Price2, dex2ExpectedPriceBips)
    // get balances after
    const [fAsset1After, usdc1After, wNat1After] = await getBalances(funded1)
    const [fAsset2After, usdc2After, wNat2After] = await getBalances(funded2)
    // output ratio of each asset spent (scarcely funded assets should have a high percentages)
    const fAsset1SpentPerc = BigInt(100) * (fAsset1Before - fAsset1After) / fAsset1Before
    const usdc1SpentPerc = BigInt(100) * (usdc1Before - usdc1After) / usdc1Before
    const wNat1SpentPerc = BigInt(100) * (wNat1Before - wNat1After) / wNat1Before
    console.log('fAsset1 spent:', `${Number(fAsset1SpentPerc)}%`)
    console.log('usdc1 spent:  ', `${Number(usdc1SpentPerc)}%`)
    console.log('wNat1 spent:  ', `${Number(wNat1SpentPerc)}%`)
    const fAsset2SpentPerc = BigInt(100) * (fAsset2Before - fAsset2After) / fAsset2Before
    const usdc2SpentPerc = BigInt(100) * (usdc2Before - usdc2After) / usdc2Before
    const wNat2SpentPerc = BigInt(100) * (wNat2Before - wNat2After) / wNat2Before
    console.log('fAsset2 spent:', `${Number(fAsset2SpentPerc)}%`)
    console.log('usdc2 spent:  ', `${Number(usdc2SpentPerc)}%`)
    console.log('wNat2 spent:  ', `${Number(wNat2SpentPerc)}%`)
  })
})