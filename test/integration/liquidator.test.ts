/**
 * yarn hardhat node --fork https://coston-api.flare.network/ext/C/rpc --fork-block-number 10556413
 */

import "dotenv/config"
import { JsonRpcProvider, Wallet, WeiPerEther, ZeroAddress } from 'ethers'
import { assert } from 'chai'
import { waitFinalize, syncDexReservesWithFtsoPrices, getCollateralPriceForAgentCr } from './helpers/utils'
import { getAgentsAssetManager, deployLiquidator, getContracts } from './helpers/contracts'
import type { JsonRpcSigner } from 'ethers'
import type { Contracts } from './helpers/interface'
import type { Liquidator } from "../../types"

// usdc balance of deployer (should basically be infinite)
const USDC_BALANCE = BigInt(100_000_000) * WeiPerEther
// agent to liquidate
const AGENT_ADDRESS = "0x6A3fad5275938549302C26678A487BfC5F9D8ba5"
// deployer is funded with FfakeXRP and CFLR, can mint USDC and set price reader prices
const DEPLOYER_PVK = process.env.DEPLOYER_PRIVATE_KEY!

const provider = new JsonRpcProvider("http://127.0.0.1:8545/")

describe("Liquidator", () => {
  let contracts: Contracts
  let deployer: Wallet
  let signer: JsonRpcSigner
  let liquidator: Liquidator

  before(async () => {
    // get relevant signers
    deployer = new Wallet(DEPLOYER_PVK, provider)
    signer = await provider.getSigner(1)
    // get contracts
    contracts = await getContracts(await getAgentsAssetManager(AGENT_ADDRESS, provider), "coston", provider)
    liquidator = await deployLiquidator(contracts.flashLender, contracts.uniswapV2, signer, provider)
    // mint USDC to deployer and wrap their CFLR (they will provide liquidity to dexes)
    await waitFinalize(provider, deployer, contracts.usdc.connect(deployer).mintAmount(deployer, USDC_BALANCE))
    const availableWNat = await provider.getBalance(deployer) - WeiPerEther
    await waitFinalize(provider, deployer, contracts.wNat.connect(deployer).deposit({ value: availableWNat })) // wrap CFLR
  })

  it("should liquidate an agent", async () => {
    // put agent in liquidation by raising xrp price and set cr slightly below ccb
    const assetPrice = await getCollateralPriceForAgentCr(contracts, AGENT_ADDRESS, 18_900, "pool") // ccb = 19_000, minCr = 20_000, safetyCr = 21_000
    await waitFinalize(provider, deployer, contracts.priceReader.connect(deployer).setPrice("testXRP", assetPrice))
    // according to the conditions constructed above, sync up dexes as stably as possible with deployer's limited funds
    await syncDexReservesWithFtsoPrices(contracts, deployer, provider)
    // check that collateral ratio is still as specified above
    const { mintedUBA: mintedUbaBefore,  poolCollateralRatioBIPS } = await contracts.assetManager.getAgentInfo(AGENT_ADDRESS)
    assert.equal(poolCollateralRatioBIPS, BigInt(18_900))
    // liquidate agent
    await waitFinalize(provider, signer, liquidator.connect(signer).runArbitrage(
      AGENT_ADDRESS, signer, 0, 1, 0, 1, ZeroAddress, ZeroAddress, [], []
    ))
    // check that agent was fully liquidated and put out of liquidation
    const { status: statusAfter, mintedUBA: mintedUbaAfter } = await contracts.assetManager.getAgentInfo(AGENT_ADDRESS)
    assert.equal(statusAfter, BigInt(0))
    // check that liquidator made a profit
    const liquidatorUsdcBalance = await contracts.usdc.balanceOf(signer)
    assert.notEqual(liquidatorUsdcBalance, BigInt(0))
    console.log("liquidator USDC profit:", liquidatorUsdcBalance.toString(), "wei")
    console.log("liquidated:", (mintedUbaBefore - mintedUbaAfter).toString(), "UBA")
  })
})