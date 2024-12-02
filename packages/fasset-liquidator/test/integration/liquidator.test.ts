/**
 * Deprecated for now
 * yarn hardhat node --fork https://coston-api.flare.network/ext/C/rpc --fork-block-number 10556413
 */

import "dotenv/config"
import chalk from 'chalk'
import { formatUnits } from "ethers"
import { JsonRpcProvider, Wallet, WeiPerEther, ZeroAddress } from 'ethers'
import { assert } from 'chai'
import { waitFinalize } from './utils/finalization'
import { getCollateralPriceForAgentCr } from "./utils/fasset"
import { DexFtsoPriceSyncer } from "./utils/uniswap-v2/dex-price-syncer"
import { getAssetManagerFromAgent, deployLiquidator, getContracts } from './utils/contracts'
import type { JsonRpcSigner } from 'ethers'
import type { Contracts } from './utils/interfaces/contracts'
import type { FakeERC20, Liquidator } from "../../types"

// usdc balance of governance (should basically be infinite)
const USDC_BALANCE = BigInt(100_000_000) * WeiPerEther
// agent to liquidate
const AGENT_ADDRESS = "0x6A3fad5275938549302C26678A487BfC5F9D8ba5"
// governance is funded with FSimCoinX and CFLR, can mint USDC and set price reader prices
const GOVERNANCE_PVK = process.env.GOVERNANCE_PRIVATE_KEY!

const RPC_URL = "http://127.0.0.1:8545/"
const provider = new JsonRpcProvider(RPC_URL)

describe("Liquidator", () => {
    let contracts: Contracts
    let governance: Wallet
    let signer: JsonRpcSigner
    let liquidator: Liquidator
    let dexSyncer: DexFtsoPriceSyncer

    before(async () => {
        // get relevant signers
        governance = new Wallet(GOVERNANCE_PVK, provider)
        signer = await provider.getSigner(1)
        // get contracts
        const assetManagerAddress = await getAssetManagerFromAgent(AGENT_ADDRESS, provider)
        contracts = await getContracts(assetManagerAddress, "coston", provider)
        liquidator = await deployLiquidator(contracts.flashLender, contracts.uniswapV2, signer, provider)
        dexSyncer = await DexFtsoPriceSyncer.create("coston", RPC_URL, assetManagerAddress, GOVERNANCE_PVK)
        // mint USDC to governance and wrap their CFLR (they will provide liquidity to dexes)
        console.log(chalk.cyan("minting USDC to governance and wrapping CFLR..."))
        const fakeUsdc = contracts.collaterals.usdc.connect(governance) as FakeERC20
        await waitFinalize(provider, governance, fakeUsdc.mintAmount(governance, USDC_BALANCE))
        const availableWNat = await provider.getBalance(governance) - WeiPerEther
        await waitFinalize(provider, governance, contracts.wNat.connect(governance).deposit({ value: availableWNat })) // wrap CFLR
    })

    it("should liquidate an agent", async () => {
        // put agent in liquidation by raising xrp price and set cr slightly below ccb
        console.log(chalk.cyan("putting agent in liquidation by setting prices on the price reader..."))
        const assetPrice = await getCollateralPriceForAgentCr(
            contracts, AGENT_ADDRESS, 18_900, contracts.wNat, "CFLR", "testXRP", "pool") // ccb = 19_000, minCr = 20_000, safetyCr = 21_000
        await waitFinalize(provider, governance, contracts.priceReader.connect(governance).setPrice("testXRP", assetPrice))
        // according to the conditions constructed above, sync up dexes as stably as possible with governance's limited funds
        console.log(chalk.cyan("syncing prices on dexes..."))
        await dexSyncer.syncDex({ pools: [
            { symbolA: "testUSDC", symbolB: "testXRP" },
            { symbolA: "WNAT", symbolB: "testXRP" }
        ]}, false)
        // check that collateral ratio is still as specified above
        const { mintedUBA: mintedUbaBefore, poolCollateralRatioBIPS } = await contracts.assetManager.getAgentInfo(AGENT_ADDRESS)
        assert.equal(poolCollateralRatioBIPS, BigInt(18_900))
        // liquidate agent
        console.log(chalk.cyan("liquidating agent..."))
        await waitFinalize(provider, signer, liquidator.connect(signer).runArbitrage(
            AGENT_ADDRESS, signer,
            {
                flashLender: ZeroAddress, dex: ZeroAddress,
                dexPair1: { minPriceMul: 0, minPriceDiv: 1, path: [] },
                dexPair2: { minPriceMul: 0, minPriceDiv: 1, path: [] }
            }
        ))
        // check that agent was fully liquidated and put out of liquidation
        const { status: statusAfter, mintedUBA: mintedUbaAfter } = await contracts.assetManager.getAgentInfo(AGENT_ADDRESS)
        assert.equal(statusAfter, BigInt(0))
        // check that liquidator made a profit
        const liquidatorUsdcBalance = await contracts.collaterals.usdc.balanceOf(signer)
        assert.notEqual(liquidatorUsdcBalance, BigInt(0))
        console.log(chalk.greenBright("profit:"), formatUnits(liquidatorUsdcBalance, 18), "USDC")
        console.log(chalk.greenBright("liquidated:"), formatUnits(mintedUbaBefore - mintedUbaAfter, 6), "FXRP")
    })
})
