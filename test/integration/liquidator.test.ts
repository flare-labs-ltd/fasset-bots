/**
 * yarn hardhat node --fork https://coston-api.flare.network/ext/C/rpc --fork-block-number 10556413
 */

import "dotenv/config"
import { ethers } from 'ethers'
import { assert } from 'chai'
import { assetPriceForAgentCr } from '../calculations'
import { waitFinalize, syncDexReservesWithFtsoPrices } from './helpers/utils'
import { getAgentsAssetManager, deployLiquidator, getContracts } from './helpers/contracts'
import type { Contracts } from './helpers/interface'

// usdc balance of deployer (should basically be infinite)
const USDC_BALANCE = BigInt(100_000_000) * ethers.WeiPerEther
// agent to liquidate
const AGENT_ADDRESS = "0x6A3fad5275938549302C26678A487BfC5F9D8ba5"
// deployer is funded with FfakeXRP and CFLR, can mint USDC and set price reader prices
const DEPLOYER_PVK = process.env.DEPLOYER_PRIVATE_KEY!

const provider = new ethers.JsonRpcProvider("http://127.0.0.1:8545/")

describe("Liquidator", () => {
  let contracts: Contracts
  let deployer: ethers.Wallet
  let liquidator: ethers.JsonRpcSigner

  // obtains the f-assets's price that results in agent having collateral ratio of crBips
  async function getCollateralForCr(collateralKind: "vault" | "pool", crBips: number): Promise<bigint> {
    const agentInfo = await contracts.assetManager.getAgentInfo(AGENT_ADDRESS)
    const totalMintedUBA = agentInfo.mintedUBA + agentInfo.redeemingUBA + agentInfo.reservedUBA
    let collateralWei
    let collateralToken
    let tokenSymbol
    if (collateralKind === "vault") {
      collateralWei = agentInfo.totalVaultCollateralWei
      collateralToken = contracts.usdc
      tokenSymbol = "testUSDC"
    } else {
      collateralWei = agentInfo.totalPoolCollateralNATWei
      collateralToken = contracts.wNat
      tokenSymbol = "CFLR"
    }
    const { 0: collateralFtsoPrice, 2: collateralFtsoDecimals } = await contracts.priceReader.getPrice(tokenSymbol)
    const { 2: fAssetFtsoDecimals } = await contracts.priceReader.getPrice("testXRP")
    return assetPriceForAgentCr(
      BigInt(crBips),
      totalMintedUBA,
      collateralWei,
      collateralFtsoPrice,
      collateralFtsoDecimals,
      await collateralToken.decimals(),
      fAssetFtsoDecimals,
      await contracts.fAsset.decimals()
    )
  }

  before(async () => {
    // get relevant signers
    deployer = new ethers.Wallet(DEPLOYER_PVK, provider)
    liquidator = await provider.getSigner(1)
    // get contracts
    contracts = await getContracts(await getAgentsAssetManager(AGENT_ADDRESS, provider), "coston", provider)
    contracts.liquidator = await deployLiquidator(contracts.flashLender, contracts.blazeSwapRouter, liquidator, provider)
    // mint USDC to deployer and wrap their CFLR (they will provide liquidity to dexes)
    await waitFinalize(provider, deployer, contracts.usdc.connect(deployer).mintAmount(deployer, USDC_BALANCE))
    const availableWNat = await provider.getBalance(deployer) - ethers.WeiPerEther
    await waitFinalize(provider, deployer, contracts.wNat.connect(deployer).deposit({ value: availableWNat })) // wrap CFLR
  })

  it("should liquidate an agent", async () => {
    // put agent in liquidation by raising xrp price and set cr slightly below ccb
    const assetPrice = await getCollateralForCr("pool", 18_900) // ccb = 19_000, minCr = 20_000, safetyCr = 21_000
    await waitFinalize(provider, deployer, contracts.priceReader.connect(deployer).setPrice("testXRP", assetPrice))
    // according to the conditions constructed above, sync up dexes as stably as possible with deployer's limited funds
    await syncDexReservesWithFtsoPrices(contracts, deployer, provider)
    // check that collateral ratio is still as specified above
    const { mintedUBA: mintedUbaBefore,  poolCollateralRatioBIPS } = await contracts.assetManager.getAgentInfo(AGENT_ADDRESS)
    assert.equal(poolCollateralRatioBIPS, BigInt(18_900))
    // liquidate agent
    await waitFinalize(provider, liquidator, contracts.liquidator.connect(liquidator).runArbitrage(AGENT_ADDRESS, liquidator))
    // check that agent was fully liquidated and put out of liquidation
    const { status: statusAfter, mintedUBA: mintedUbaAfter } = await contracts.assetManager.getAgentInfo(AGENT_ADDRESS)
    assert.equal(statusAfter, BigInt(0))
    // check that liquidator made a profit
    const liquidatorUsdcBalance = await contracts.usdc.balanceOf(liquidator)
    assert.notEqual(liquidatorUsdcBalance, BigInt(0))
    console.log("liquidator USDC profit:", liquidatorUsdcBalance.toString(), "wei")
    console.log("liquidated:", (mintedUbaBefore - mintedUbaAfter).toString(), "UBA")
  })
})