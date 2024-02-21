import { ethers } from 'hardhat'
import { expect } from 'chai'
import * as calc from '../calculations'
import { sqrt } from './helpers/utils'
import { addLiquidity, swap, swapOutput, swapAndAddLiquidityToGetReserves } from './helpers/uniswap-v2'
import deployUniswapV2 from './fixtures/dexes'
import { getFactories } from './fixtures/context'
import { XRP, USDT, WFLR } from './fixtures/assets'
import type { HardhatEthersSigner } from '@nomicfoundation/hardhat-ethers/signers'
import type { IUniswapV2Router, ERC20Mock } from '../../types'


describe("Tests for the UniswapV2 implementation", () => {
    // default "real" token prices
    const priceTokenAUsd5 = BigInt(100_000) // price of USDT in USD5
    const priceTokenBUsd5 = BigInt(50_000) // price of XRP in USD5
    const priceTokenCUsd5 = BigInt(420) // price of FLR in USD5
    // set before each
    let accounts: HardhatEthersSigner[]
    let signer: HardhatEthersSigner
    let wNat: ERC20Mock
    let uniswapV2: IUniswapV2Router
    let tokenA: ERC20Mock
    let tokenB: ERC20Mock
    let tokenC: ERC20Mock
    let decimalsA: bigint
    let decimalsB: bigint
    let decimalsC: bigint

    async function addInitialLiquidity(valueUsd5 = BigInt(1_000_000_00000)): Promise<void> {
        const tokenALiquidityDex1 = calc.convertUsd5ToToken(valueUsd5, decimalsA, priceTokenAUsd5)
        const tokenBLiquidityDex1 = calc.convertUsd5ToToken(valueUsd5, decimalsB, priceTokenBUsd5)
        await addLiquidity(uniswapV2, tokenA, tokenB, tokenALiquidityDex1, tokenBLiquidityDex1, signer)
        const tokenBLiquidityDex2 = calc.convertUsd5ToToken(valueUsd5, decimalsB, priceTokenBUsd5)
        const tokenCLiquidityDex2 = calc.convertUsd5ToToken(valueUsd5, decimalsC, priceTokenCUsd5)
        await addLiquidity(uniswapV2, tokenB, tokenC, tokenBLiquidityDex2, tokenCLiquidityDex2, signer)
        const tokenALiquidityDex3 = calc.convertUsd5ToToken(valueUsd5, decimalsA, priceTokenAUsd5)
        const tokenCLiquidityDex3 = calc.convertUsd5ToToken(valueUsd5, decimalsC, priceTokenCUsd5)
        await addLiquidity(uniswapV2, tokenA, tokenC, tokenALiquidityDex3, tokenCLiquidityDex3, signer)
    }

    async function multiswap(
        swapA: bigint,
        swapB: bigint
    ): Promise<void> {
        if (swapA > 0) {
            await tokenA.mint(signer, swapA)
            await swap(uniswapV2, [tokenA, tokenB], swapA, signer)
        } else if (swapB > 0) {
            await tokenB.mint(signer, swapB)
            await swap(uniswapV2, [tokenB, tokenA], swapB, signer)
        }
    }

    // swap on dexes to achieve the given price
    async function swapToPrice(
        priceA: bigint,
        priceB: bigint
    ): Promise<void> {
        const [reserveA, reserveB] = await uniswapV2.getReserves(tokenA, tokenB)
        const swapA = calc.swapToDexPrice(reserveA, reserveB, priceA, priceB, decimalsA, decimalsB)
        const swapB = calc.swapToDexPrice(reserveB, reserveA, priceB, priceA, decimalsB, decimalsA)
        await multiswap(swapA, swapB)
    }

    async function swapToRatio(
        ratioA: bigint,
        ratioB: bigint
    ): Promise<void> {
        const [reserveA, reserveB] = await uniswapV2.getReserves(tokenA, tokenB)
        const swapA = calc.swapToDexRatio(reserveA, reserveB, ratioA, ratioB)
        const swapB = calc.swapToDexRatio(reserveB, reserveA, ratioB, ratioA)
        await multiswap(swapA, swapB)
    }

    beforeEach(async function () {
        // signers
        accounts = await ethers.getSigners()
        signer = accounts[10]
        // contracts
        const factories = await getFactories()
        wNat = await factories.pool.deploy(WFLR.name, WFLR.symbol, WFLR.decimals)
        uniswapV2 = await deployUniswapV2(wNat, accounts[0])
        // set tokens
        tokenA = await factories.vault.deploy(USDT.name, USDT.symbol, USDT.decimals)
        tokenB = await factories.fAsset.deploy(XRP.name, XRP.symbol, XRP.decimals)
        tokenC = await factories.pool.deploy(WFLR.name, WFLR.symbol, WFLR.decimals)
        // set decimals for easier access
        decimalsA = await tokenA.decimals()
        decimalsB = await tokenB.decimals()
        decimalsC = await tokenC.decimals()
    })

    describe("base functionality", () => {

        it("should add liquidity", async () => {
            // params
            const initialLiquidityTokenA = BigInt(10) ** decimalsA
            const initialLiquidityTokenB = BigInt(10) ** decimalsB
            const addedLiquidityTokenA = BigInt(41412) * BigInt(10) ** decimalsA
            const addedLiquidityTokenB = BigInt(1231) * BigInt(10) ** decimalsB
            // execute test
            await addLiquidity(uniswapV2, tokenA, tokenB, initialLiquidityTokenA, initialLiquidityTokenB, signer)
            const [reserveA, reserveB] = await uniswapV2.getReserves(tokenA, tokenB)
            const balanceA = await tokenA.balanceOf(signer)
            const balanceB = await tokenB.balanceOf(signer)
            expect(balanceA).to.equal(0)
            expect(balanceB).to.equal(0)
            // try adding more liquidity
            await tokenA.mint(signer, addedLiquidityTokenA)
            await tokenB.mint(signer, addedLiquidityTokenB)
            await addLiquidity(uniswapV2, tokenA, tokenB, addedLiquidityTokenA, addedLiquidityTokenB, signer, false)
            // check that the liquidity is correct
            const balanceAAfter = await tokenA.balanceOf(signer)
            const balanceBAfter = await tokenB.balanceOf(signer)
            const [expectedAddedA, expectedAddedB] = calc.optimalAddedLiquidity(
                reserveA, reserveB, addedLiquidityTokenA, addedLiquidityTokenB)
            expect(balanceAAfter).to.equal(addedLiquidityTokenA - expectedAddedA)
            expect(balanceBAfter).to.equal(addedLiquidityTokenB - expectedAddedB)
        })

        it("should swap tokenA for tokenB", async () => {
            // params
            const swapInA = BigInt(10) ** BigInt(decimalsA)
            // execute test
            await addInitialLiquidity()
            const [liquidityABefore, liquidityBBefore] = await uniswapV2.getReserves(tokenA, tokenB)
            await tokenA.mint(signer, swapInA)
            await swap(uniswapV2, [tokenA, tokenB], swapInA, signer)
            const [liquidityAAfter, liquidityBAfter] = await uniswapV2.getReserves(tokenA, tokenB)
            // check liquidity
            expect(liquidityAAfter - liquidityABefore).to.equal(swapInA)
            const swapOutB = calc.swapOutput(swapInA, liquidityABefore, liquidityBBefore)
            expect(liquidityBBefore - liquidityBAfter).to.equal(swapOutB)
            // check user funds
            expect(await tokenA.balanceOf(signer)).to.equal(0)
            expect(await tokenB.balanceOf(signer)).to.equal(swapOutB)
        })

        it("should swap with a non-default path", async () => {
            // add initial default liquidity
            await addInitialLiquidity()
            // amount of token A to swap ($0.01)
            const swapInA = calc.convertUsd5ToToken(BigInt(100), decimalsA, priceTokenAUsd5)
            // swap from tokenA to tokenC via tokenB
            const swapCOut = await swapOutput(uniswapV2, [tokenA, tokenB, tokenC], swapInA)
            await tokenA.connect(signer).mint(signer, swapInA)
            await swap(uniswapV2, [tokenA, tokenB, tokenC], swapInA, signer)
            // check that the minter got the right amount of tokenC
            const balanceTokenC = await tokenC.balanceOf(signer)
            expect(balanceTokenC).to.equal(swapCOut)
        })

        it("should restrict swap output if slippage is too high", async () => {
            // declare vars for multiple tests
            let minPriceMul: bigint
            let minPriceDiv: bigint
            let minOutB: bigint
            // setup
            await addInitialLiquidity()
            const [reserveA, reserveB] = await uniswapV2.getReserves(tokenA, tokenB)
            const amountA = reserveA / BigInt(1234)
            await tokenA.mint(signer, amountA)
            // three tests
            // can't swap our amount at zero slippage
            ;[minPriceMul, minPriceDiv] = calc.dexMinPriceFromMaxSlippage(0, reserveA, reserveB)
            minOutB = amountA * minPriceMul / minPriceDiv
            await expect(swap(uniswapV2, [tokenA, tokenB], amountA, signer, minOutB))
                .to.be.revertedWith("BlazeSwapRouter: INSUFFICIENT_OUTPUT_AMOUNT")
            // can't swap at too low slippage of 0.1%
            ;[minPriceMul, minPriceDiv] = calc.dexMinPriceFromMaxSlippage(10, reserveA, reserveB)
            minOutB = amountA * minPriceMul / minPriceDiv
            await expect(swap(uniswapV2, [tokenA, tokenB], amountA, signer, minOutB))
                .to.be.revertedWith("BlazeSwapRouter: INSUFFICIENT_OUTPUT_AMOUNT")
            // can't swap at slippage a little below max
            const slippage = calc.slippageBipsFromSwapAmountIn(amountA, reserveA, reserveB)
            ;[minPriceMul, minPriceDiv] = calc.dexMinPriceFromMaxSlippage(Number(slippage) - 1, reserveA, reserveB)
            minOutB = amountA * minPriceMul / minPriceDiv
            await expect(swap(uniswapV2, [tokenA, tokenB], amountA, signer, minOutB))
                .to.be.revertedWith("BlazeSwapRouter: INSUFFICIENT_OUTPUT_AMOUNT")
            // can swap at slippage a little above max
            ;[minPriceMul, minPriceDiv] = calc.dexMinPriceFromMaxSlippage(Number(slippage) + 1, reserveA, reserveB)
            minOutB = amountA * minPriceMul / minPriceDiv
            const amountB = await swapOutput(uniswapV2, [tokenA, tokenB], amountA)
            await swap(uniswapV2, [tokenA, tokenB], amountA, signer, minOutB)
            const balanceB = await tokenB.balanceOf(signer)
            expect(balanceB).to.equal(amountB)
        })
    })

    describe("implicit dex property setters", () => {

        it("should swap on dex to achieve a given reserve ratio", async () => {
            // params
            const desiredRatioA = BigInt(15100)
            const desiredRatioB = BigInt(1400)
            // execute test
            await addInitialLiquidity()
            await swapToRatio(desiredRatioA, desiredRatioB)
            const [reserveA, reserveB] = await uniswapV2.getReserves(tokenA, tokenB)
            const error = desiredRatioB * reserveA - desiredRatioA * reserveB
            expect(error).to.be.below(sqrt(reserveA * reserveB))
        })

        it("should swap on dexes to achieve given price", async () => {
            // params
            const priceDecimals = 18
            const precision = BigInt(1e1)
            const valueUsd5 = BigInt(51513534)
            const swappedTokenA = BigInt(1e3) * BigInt(10) ** decimalsA
            // execute test
            await addInitialLiquidity(valueUsd5)
            await tokenA.mint(signer, swappedTokenA)
            await swap(uniswapV2, [tokenA, tokenB], swappedTokenA, signer) // ruin the dex price
            await swapToPrice(priceTokenAUsd5, priceTokenBUsd5)
            // check that reserves produce the right price
            const [reserveA, reserveB] = await uniswapV2.getReserves(tokenA, tokenB)
            const [wPriceA, wPriceB] = calc.priceAB(priceTokenAUsd5, priceTokenBUsd5, decimalsA, decimalsB)
            const priceMultiplier = BigInt(10) ** BigInt(priceDecimals)
            const realPrice = priceMultiplier * wPriceA / wPriceB
            const dexPrice = priceMultiplier * reserveB / reserveA
            expect(dexPrice).to.be.approximately(realPrice, precision)
        })

        it("should combine swapping with adding liquidity to produce given dex reserves", async () => {
            // define params
            const oldReservesA = BigInt(100) * BigInt(10) ** decimalsA
            const oldReservesB = BigInt(23) * BigInt(10) ** decimalsB
            const newReservesA = BigInt(19) * BigInt(10) ** decimalsA
            const newReservesB = BigInt(1412) * BigInt(10) ** decimalsB
            // execute test
            await addLiquidity(uniswapV2, tokenA, tokenB, oldReservesA, oldReservesB, signer)
            const [_oldReservesA, _oldReservesB] = await uniswapV2.getReserves(tokenA, tokenB)
            expect(_oldReservesA).to.equal(oldReservesA)
            expect(_oldReservesB).to.equal(oldReservesB)
            await swapAndAddLiquidityToGetReserves(uniswapV2, tokenA, tokenB, newReservesA, newReservesB, signer)
            const [reserveA, reserveB] = await uniswapV2.getReserves(tokenA, tokenB)
            expect(reserveA).to.be.approximately(newReservesA, sqrt(newReservesA) / BigInt(100))
            expect(reserveB).to.be.approximately(newReservesB, sqrt(newReservesB) / BigInt(100))
        })

        it.only("should produce produce a specified slippage rate on the dex", async () => {
            // params
            const slippage = {
                volume: BigInt(1e8) * BigInt(10) ** decimalsA, // one TokenA
                bips: 100 // 1%
            }
            // add initial liquidity
            await addInitialLiquidity()
            // add liquidity to reflect the slippage at given volume
            const [oldReserveA, oldReserveB] = await uniswapV2.getReserves(tokenA, tokenB)
            const [addedLiquidityA, addedLiquidityB] = calc.addedliquidityFromSlippage(
                slippage.volume, slippage.bips, oldReserveA, oldReserveB)
            await addLiquidity(uniswapV2, tokenA, tokenB, addedLiquidityA, addedLiquidityB, signer)
            // theoretically check that the slippage was correct
            const [newReserveA, newReserveB] = await uniswapV2.getReserves(tokenA, tokenB)
            const theoreticalSlippageBips = calc.slippageBipsFromSwapAmountIn(slippage.volume, newReserveA, newReserveB)
            expect(theoreticalSlippageBips).to.be.approximately(slippage.bips, 10)
            // check that the slippage was correct
            await tokenA.mint(signer, slippage.volume)
            await swap(uniswapV2, [tokenA, tokenB], slippage.volume, signer)
            const obtainedTokenB = await tokenB.balanceOf(signer)
            const practicalSlippageBips = calc.slippageBipsFromSwapAmountOut(obtainedTokenB, newReserveA, newReserveB)
            expect(practicalSlippageBips).to.be.approximately(slippage.bips, 10)
        })
    })
})