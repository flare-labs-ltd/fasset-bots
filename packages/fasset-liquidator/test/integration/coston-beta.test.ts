/**
 * This test is run to check whether the dexes are set up correctly from multiple funded addresses
 * The first `it` can then be run on the real network to establish the dex, though cli is preferred.
 * It is basically testing the `setOrUpdateDexes` function.
 */

import "dotenv/config"
import { expect } from 'chai'
import { abs } from "../utils"
import { slippageBipsFromSwapAmountIn } from "../calculations/calculations"
import { swap } from "./utils/uniswap-v2/wrappers"
import { DexManipulator } from "./utils/uniswap-v2/dex-manipulator"
import { FASSET_MAX_BIPS, PRICE_PRECISION } from "../constants"
import { FTSO_SYMBOLS, ASSET_MANAGER_ADDRESSES, DEX_POOLS } from "../config"
import type { PoolConfig } from "./utils/uniswap-v2/dex-manipulator"


const RPC_URL = "http://127.0.0.1:8545/"
// asset manager address for FtestXRP
// two accounts funded with FtestXRP and CFLR
const SIGNER_PRIVATE_KEY = process.env.PRIVATE_KEY!

const MAX_PRICE_ERROR = PRICE_PRECISION / BigInt(1e5) // price is accurate to 5 decimals (so FTSOs prices are not affected)
const MAX_SLIPPAGE_BIPS_ERROR = 10 // expect configured slippage to differentiate for at most this amounts
const MAX_TOKEN_LOSS_BIPS = 1 // expect to lose at most .01% of the invested balance (some liquidity stays locked after removal)

// test environment configuration
const COSTON_FTSO_SYMBOLS = FTSO_SYMBOLS["coston"]
const ASSET_MANAGER = ASSET_MANAGER_ADDRESSES["coston"]["FtestXRP"]
const COSTON_DEX_POOLS = DEX_POOLS["coston"]["FtestXRP"]

// slippage config where swapping 1e6 = 1 TEST_XRP should result in 10% slippage
// this way the added reserves should require at most 100 TEST_XRP (deficient token)
const POOL_SLIPPAGE_CONFIG_1 = COSTON_DEX_POOLS.map(([symbolA, symbolB]) => ({
    symbolA, symbolB, slippage: { amountA: BigInt(1e6), bips: 1000 }
}))
const POOL_SLIPPAGE_CONFIG_2 = POOL_SLIPPAGE_CONFIG_1.map(pool => {
    if (pool.symbolB == COSTON_FTSO_SYMBOLS.USDC) {
        return { ...pool, slippage: { amountA: BigInt(1e6), bips: 500 } }
    } else if (pool.symbolB == COSTON_FTSO_SYMBOLS.WETH) {
        return { ...pool, slippage: { amountA: BigInt(1e6), bips: 1200 } }
    } else {
        return pool
    }
})

describe("Uniswap V2 Price Synchronization", () => {
    let manipulator: DexManipulator
    let signerBalanceBefore: Map<string, bigint>

    async function getSignerBalances(): Promise<Map<string, bigint>> {
        const balances = new Map<string,bigint>()
        for (const symbol of Object.values(manipulator.symbols)) {
            const token = manipulator.symbolToToken.get(symbol)!
            balances.set(symbol, await token.balanceOf(manipulator.signer))
        }
        const natBalance = await manipulator.provider.getBalance(manipulator.signer)
        return balances.set(manipulator.symbols.WNAT, balances.get(manipulator.symbols.WNAT)! + natBalance)
    }

    async function assertNoLiquidity(): Promise<void> {
        for (const [symbolA, symbolB] of COSTON_DEX_POOLS) {
            const tokenA = manipulator.symbolToToken.get(symbolA)!
            const tokenB = manipulator.symbolToToken.get(symbolB)!
            const [reserveA, reserveB] = await manipulator.getReserves(tokenA, tokenB)
            expect(Number(reserveA)).to.equal(0)
            expect(Number(reserveB)).to.equal(0)
        }
    }

    async function assertDexPricesFtsoSynced(): Promise<void> {
        for (const [symbolA, symbolB] of COSTON_DEX_POOLS) {
            const tokenA = manipulator.symbolToToken.get(symbolA)!
            const tokenB = manipulator.symbolToToken.get(symbolB)!
            const ftsoPrice = await manipulator.getFtsoPriceForPair(symbolA, symbolB)
            const dexPrice = await manipulator.getDexPriceForPair(tokenA, tokenB)
            expect(abs(ftsoPrice - dexPrice) <= MAX_PRICE_ERROR).to.be.true
        }
    }

    async function assertPoolConfig(pools: PoolConfig[]): Promise<void> {
        for (const pool of pools) {
            if (pool.slippage !== undefined) {
                const tokenA = manipulator.symbolToToken.get(pool.symbolA)!
                const tokenB = manipulator.symbolToToken.get(pool.symbolB)!
                const [reserveA,] = await manipulator.getReserves(tokenA, tokenB)
                const slippageBips = slippageBipsFromSwapAmountIn(pool.slippage.amountA, reserveA)
                expect(Number(slippageBips)).to.be.approximately(pool.slippage.bips, MAX_SLIPPAGE_BIPS_ERROR)
            }
        }
    }

    before(async () => {
        // get relevant signers
        manipulator = await DexManipulator.create("coston", RPC_URL, ASSET_MANAGER, SIGNER_PRIVATE_KEY)
        // wrap signer's CFLR
        await manipulator.wrapWNat()
        // aux test cache
        signerBalanceBefore = await getSignerBalances()
    })

    it("should add liquidity to dexes to match ftso prices and slippage config", async () => {
        await assertNoLiquidity()
        // add liquidity to match slippage and ftso price by investing all of the signer's tokens
        // except for 0.5 x USDC balance and 0.5 CFLR balance
        // distribute to  pools evenly, not greedily
        await manipulator.adjustDex({ pools: POOL_SLIPPAGE_CONFIG_1, maxRelativeSpendings: { [manipulator.symbols.USDC]: 0.5 } }, false)
        // check that reserves are aligned with ftso prices on all relevant dex pools
        await assertDexPricesFtsoSynced()
        // check that slippage on all pools is as specified
        await assertPoolConfig(POOL_SLIPPAGE_CONFIG_1)
    })

    it("should swap to fix the price discrepancy", async () => {
        // someone makes a swap raising WNAT / USDC price through slippage
        const { 0: usdcReserve } = await manipulator.contracts.uniswapV2.getReserves(
            manipulator.contracts.collaterals.USDC, manipulator.contracts.fAsset)
        const swapAmount = usdcReserve / BigInt(100) // 1% of the reserve
        // swap to disrupt the price
        console.log(`swapping ${swapAmount} USDC for TEST_XRP to disrupt the dex price`)
        await swap(manipulator.contracts.uniswapV2, manipulator.contracts.collaterals.USDC,
            manipulator.contracts.fAsset, swapAmount, manipulator.signer, manipulator.provider)
        // sort out the price discrepancy by syncing all pools with ftso prices
        await manipulator.adjustDex({ pools: COSTON_DEX_POOLS.map(([symbolA, symbolB]) => ({ symbolA, symbolB, sync: true })) }, true)
        // check that reserves are aligned with ftso prices on all relevant dex pools
        await assertDexPricesFtsoSynced()
    })

    it("should adjust the slippage with a new configuration", async () => {
        // adjust dexes
        await manipulator.adjustDex({ pools: POOL_SLIPPAGE_CONFIG_2 }, false)
        // we don't check prices as we are setting slippage only
        // check that slippage on all pools is as specified
        await assertPoolConfig(POOL_SLIPPAGE_CONFIG_2)
    })

    it("should remove liquidity from dexes", async () => {
        // remove signer's liquidity from all dexes
        await manipulator.removeAllLiquidity({ pools: COSTON_DEX_POOLS.map(([symbolA, symbolB]) => ({ symbolA, symbolB })) })
        // check that signer had funds returned (minus accounting for some locked liquidity)
        const signerBalanceAfter = await getSignerBalances()
        for (const symbol of Object.values(manipulator.symbols)) {
            const before = signerBalanceBefore.get(symbol)!
            if (before == BigInt(0)) continue
            const after = signerBalanceAfter.get(symbol)!
            const lossBips = (before - after) * FASSET_MAX_BIPS / before
            expect(Number(lossBips)).to.be.lessThanOrEqual(MAX_TOKEN_LOSS_BIPS)
        }
    })

})