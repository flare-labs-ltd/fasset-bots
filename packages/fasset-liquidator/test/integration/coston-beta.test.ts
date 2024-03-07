/**
 * This test is run to check whether the dexes are set up correctly from multiple funded addresses
 * The first `it` can then be run on the real network to establish the dex, though cli is preferred.
 * It is basically testing the `setOrUpdateDexes` function.
 */

import "dotenv/config"
import { expect } from 'chai'
import { swap } from "./utils/uniswap-v2/wrappers"
import { DexManipulator } from "./utils/uniswap-v2/coston-beta"
import { FASSET_MAX_BIPS, PRICE_PRECISION } from "../constants"


const RPC_URL = "http://127.0.0.1:8545/"
// asset manager address for FtestXRP
const ASSET_MANAGER = "0x72995b59d89B0Dc7853a5Da1E16D6940522f2D7B"
// two accounts funded with FtestXRP and CFLR
const SIGNER_PRIVATE_KEY = process.env.DEX_SIGNER_PRIVATE_KEY!

const PRICE_MAX_ERROR = PRICE_PRECISION / BigInt(1e5) // price is accurate to the point of FTSO error of 5 decimals
const MAX_LOSS_BIPS = BigInt(1) // expect to lose at most .01% of the invested balance (some liquidity will stay locked)

describe("Uniswap V2 Price Synchronization", () => {
    let manipulator: DexManipulator
    let signerBalanceBefore: bigint[]

    async function signerBalances(): Promise<bigint[]> {
        const balances = [
            await manipulator.provider.getBalance(manipulator.signer)
            + await manipulator.contracts.wNat.balanceOf(manipulator.signer),
            await manipulator.contracts.fAsset.balanceOf(manipulator.signer)
        ]
        for (const collateralToken of manipulator.supportedCollaterals) {
            balances.push(await collateralToken.contract.balanceOf(manipulator.signer))
        }
        return balances
    }

    async function checkFtsoSyncedDexPrices(): Promise<void> {
        for (const [tokenA, tokenB] of manipulator.tokenPairs) {
            const ftsoPrice = await manipulator.getFtsoPriceForPair(tokenA.symbol, tokenB.symbol)
            const dexPrice = await manipulator.getDexPriceForPair(tokenA.contract, tokenB.contract)
            expect(ftsoPrice / PRICE_MAX_ERROR).to.equal(dexPrice / PRICE_MAX_ERROR)
        }
    }

    before(async () => {
        // get relevant signers
        manipulator = await DexManipulator.create("coston", RPC_URL, ASSET_MANAGER, SIGNER_PRIVATE_KEY)
        // aux test cache
        signerBalanceBefore = await signerBalances()
        // wrap signer's CFLR (they will provide liquidity to dexes)
        await manipulator.wrapWNat()
    })

    it("should add liquidity to dexes to match ftso prices", async () => {
        await manipulator.displayDexReserves()
        // add liquidity from the primary source if they have funds
        await manipulator.initDexes({ [manipulator.symbols.USDC]: 0.5, [manipulator.symbols.WNAT]: 0.5 })
        // check that reserves are aligned with ftso prices on all relevant dex pools
        await checkFtsoSyncedDexPrices()
    })

    it("should swap to fix the price discrepancy", async () => {
        // someone makes a swap raising WNAT / USDC price through slippage
        const { 0: usdcReserve } = await manipulator.contracts.uniswapV2.getReserves(
            manipulator.contracts.collaterals.usdc, manipulator.contracts.wNat)
        const swapAmount = usdcReserve / BigInt(100) // 1% of the reserve
        // swap to disrupt the price
        console.log(`swapping ${swapAmount} USDC for CFLR to disrupt the dex price`)
        await swap(manipulator.contracts.uniswapV2, manipulator.contracts.collaterals.usdc,
            manipulator.contracts.wNat, swapAmount, manipulator.signer, manipulator.provider)
        // sort out the price discrepancy (spend at most 50% of all USDC balance, for the next test)
        await manipulator.syncDexes()
        // check that reserves are aligned with ftso prices on all relevant dex pools
        await checkFtsoSyncedDexPrices()
    })

    it("should adjust dex liquidity so they have a specified slippage", async () => {
        // adjust liquidity to have 1% slippage on all dexes
        const balanceUsdc = await manipulator.contracts.collaterals.usdc.balanceOf(manipulator.signer)
        const slippage = [
            { symbolA: manipulator.symbols.USDC, symbolB: manipulator.symbols.WNAT, amount: balanceUsdc / BigInt(100), bips: BigInt(100) }
        ]
    })

    it("should remove liquidity from dexes", async () => {
        // remove signer's liquidity from all dexes
        await manipulator.removeAllLiquidity()
        // check that signer had funds returned (minus accounting for some locked liquidity)
        const signerBalanceAfter = await signerBalances()
        for (let i = 0; i < signerBalanceAfter.length; i++) {
            if (signerBalanceBefore[i] == BigInt(0)) continue
            const lossBips = (signerBalanceBefore[i] - signerBalanceAfter[i]) * FASSET_MAX_BIPS / signerBalanceBefore[i]
            expect(Number(lossBips)).to.be.lessThanOrEqual(Number(MAX_LOSS_BIPS))
        }
    })

})