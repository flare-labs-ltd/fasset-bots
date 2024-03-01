/**
 * This test is run to check whether the dexes are set up correctly from multiple funded addresses
 * The first `it` can then be run on the real network to establish the dex, though cli is preferred.
 * It is basically testing the `setOrUpdateDexes` function.
 */

import "dotenv/config"
import { expect } from 'chai'
import { parseUnits, WeiPerEther, Wallet, JsonRpcProvider } from 'ethers'
import { relativePriceAB } from "../calculations"
import { waitFinalize } from './utils/finalization'
import { safelyGetReserves, swap } from "./utils/uniswap-v2/wrappers"
import { getCollateralInfo, setOrUpdateDexes, removeAllLiquidity } from "./utils/uniswap-v2/coston-beta"
import { getContracts } from './utils/contracts'
import { FTSO_SYMBOLS } from "../constants"
import type { Contracts } from './utils/interfaces/contracts'
import type { IERC20Metadata } from "../../types"


// forked coston (run `yarn fork`)
const provider = new JsonRpcProvider("http://127.0.0.1:8545/")
// asset manager address for FtestXRP
const ASSET_MANAGER = "0x72995b59d89B0Dc7853a5Da1E16D6940522f2D7B"
// two accounts funded with FtestXRP and CFLR
const SIGNER_PRIVATE_KEY = process.env.DEX_SIGNER_PRIVATE_KEY!

const COSTON_FTSO_SYMBOLS = FTSO_SYMBOLS['coston']
const PRICE_PRECISION = BigInt(1e6)

describe("Uniswap V2 Price Synchronization", () => {
    let signer: Wallet
    let contracts: Contracts
    let collateralInfo: [IERC20Metadata, string][]
    let decimalsAsset: bigint
    let decimalsWNat: bigint = BigInt(18)
    let signerBalanceBefore: bigint[]

    async function getSignerBalances(): Promise<bigint[]> {
        const balances = [
            await provider.getBalance(signer)
            + await contracts.wNat.balanceOf(signer),
            await contracts.fAsset.balanceOf(signer),
            await contracts.wNat.balanceOf(signer)
        ]
        for (const [collateralToken,] of collateralInfo) {
            balances.push(await collateralToken.balanceOf(signer))
        }
        return balances
    }

    async function getRelativeFtsoPricesForCollateral(
        collateralToken: IERC20Metadata,
        collateralSymbol: string
    ): Promise<[bigint, bigint]> {
        const decimalsCollateral = await collateralToken.decimals()
        const { 0: collateralPrice } = await contracts.priceReader.getPrice(collateralSymbol)
        const { 0: fAssetPrice } = await contracts.priceReader.getPrice(COSTON_FTSO_SYMBOLS.TEST_XRP)
        const { 0: wNatPrice } = await contracts.priceReader.getPrice(COSTON_FTSO_SYMBOLS.WNAT)
        return [
            getRelativePrice(collateralPrice, fAssetPrice, decimalsCollateral, decimalsAsset),
            getRelativePrice(wNatPrice, collateralPrice, decimalsWNat, decimalsCollateral)
        ]
    }

    async function getDexPricesForCollateral(
        collateralToken: IERC20Metadata
    ): Promise<[bigint, bigint]> {
        const decimalsCollateral = await collateralToken.decimals()
        const [fAssetReserveDex1, collateralReserveDex1] = await contracts.uniswapV2.getReserves(contracts.fAsset, collateralToken)
        const [collateralReserveDex2, wNatReserveDex2] = await contracts.uniswapV2.getReserves(collateralToken, contracts.wNat)
        return [
            getRelativePrice(fAssetReserveDex1, collateralReserveDex1, decimalsAsset, decimalsCollateral),
            getRelativePrice(collateralReserveDex2, wNatReserveDex2, decimalsCollateral, decimalsWNat)
        ]
    }

    function getRelativePrice(priceA: bigint, priceB: bigint, decimalsA: bigint, decimalsB: bigint): bigint {
        const [mul, div] = relativePriceAB(priceA, priceB, decimalsA, decimalsB)
        return PRICE_PRECISION * mul / div
    }

    before(async () => {
        // get relevant signers
        signer = new Wallet(SIGNER_PRIVATE_KEY, provider)
        // get contracts
        contracts = await getContracts(ASSET_MANAGER, "coston", provider)
        collateralInfo = getCollateralInfo(contracts)
        decimalsAsset = await contracts.fAsset.decimals()
        signerBalanceBefore = await getSignerBalances()
        // mint USDC to funded accounts and wrap their CFLR (they will provide liquidity to dexes)
        const availableWNat1 = await provider.getBalance(signer) - WeiPerEther
        await waitFinalize(provider, signer, contracts.wNat.connect(signer).deposit({ value: availableWNat1 })) // wrap CFLR
    })

    // this test should be run before setting up the dex ecosystem. Needed when testing F-Asset system on Coston
    // it is basically testing the `setOrUpdateDexes` function
    it("should add liquidity to dexes to match the appropriate ftso price", async () => {
        const initialReservesDex1 = await safelyGetReserves(contracts.uniswapV2, contracts.fAsset, contracts.collaterals.usdc)
        const initialReservesDex2 = await safelyGetReserves(contracts.uniswapV2, contracts.wNat, contracts.collaterals.usdc)
        console.log("initial reserves on dex1:", initialReservesDex1)
        console.log("initial reserves on dex2:", initialReservesDex2)
        // add liquidity from the primary source if they have funds
        console.log("syncing dex reserves with ftso prices")
        await setOrUpdateDexes(contracts, signer, provider, false)
        // check that reserves are aligned with ftso prices on all relevant dex pools
        for (const [collateralToken, collateralSymbol] of collateralInfo) {
            const [ftsoPriceDex1, ftsoPriceDex2] = await getRelativeFtsoPricesForCollateral(collateralToken, collateralSymbol)
            const [dexPriceDex1, dexPriceDex2] = await getDexPricesForCollateral(collateralToken)
            expect(dexPriceDex1).to.equal(ftsoPriceDex1)
            expect(dexPriceDex2).to.equal(ftsoPriceDex2)
        }
    })

    // for this test signer should have 1 UDSC
    it("should swap to fix the price discrepancy", async () => {
        // someone makes the transaction that raises dex price through slippage
        const usdcDecimals = await contracts.collaterals.usdc.decimals()
        const swapAmount = parseUnits("1", usdcDecimals)
        console.log("swapping some WFLR for USDC to disrupt the price")
        // swap to disrupt the price
        await swap(contracts.uniswapV2, contracts.collaterals.usdc, contracts.wNat, swapAmount, signer, provider)
        // sort out the price discrepancy
        await setOrUpdateDexes(contracts, signer, provider, false)
        // check that reserves are aligned with ftso prices on all relevant dex pools
        for (const [collateralToken, collateralSymbol] of collateralInfo) {
            const [ftsoPriceDex1, ftsoPriceDex2] = await getRelativeFtsoPricesForCollateral(collateralToken, collateralSymbol)
            const [dexPriceDex1, dexPriceDex2] = await getDexPricesForCollateral(collateralToken)
            expect(dexPriceDex1).to.equal(ftsoPriceDex1)
            expect(dexPriceDex2).to.equal(ftsoPriceDex2)
        }
    })

    it("should remove liquidity from dexes", async () => {
        // remove signer's liquidity from all dexes
        console.log("removing signer's liquidity")
        await removeAllLiquidity(contracts, signer, provider)
        // TODO: check that signer had funds returned (minus locked initial liquidity + nat gas costs)
        const signerBalanceAfter = await getSignerBalances()
        for (let i = 0; i < signerBalanceAfter.length; i++) {
            console.log('-------- balance compare --------')
            console.log("Before: ", signerBalanceBefore[i])
            console.log("After:  ", signerBalanceAfter[i])
        }
    })

})