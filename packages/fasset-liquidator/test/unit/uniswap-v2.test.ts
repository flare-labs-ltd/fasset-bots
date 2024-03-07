import { ethers } from 'hardhat'
import { expect } from 'chai'
import { isqrt } from '../utils'
import * as calc from '../calculations'
import {
    addLiquidity, swap, swapOutput, swapToRatio, swapToPrice,
    changeLiquidityToProduceSlippage, swapAndChangeLiquidityToGetReserves, swapInput
} from './utils/uniswap-v2'
import deployUniswapV2 from './fixtures/dexes'
import { getFactories } from './fixtures/context'
import { XRP, USDT, ETH, WFLR } from './fixtures/assets'
import type { HardhatEthersSigner } from '@nomicfoundation/hardhat-ethers/signers'
import type { IUniswapV2Router, IUniswapV2Pair, ERC20Mock } from '../../types'


const ASSET_A = USDT
const ASSET_B = XRP
const ASSET_C = ETH

const RESERVE_CHANGE_FIXTURE = [
    {
        oldA: BigInt(100) * BigInt(10) ** ASSET_A.decimals,
        oldB: BigInt(23) * BigInt(10) ** ASSET_B.decimals,
        newA: BigInt(19) * BigInt(10) ** ASSET_A.decimals,
        newB: BigInt(10) * BigInt(10) ** ASSET_B.decimals
    },
    {
        oldA: BigInt(131) * BigInt(10) ** ASSET_A.decimals,
        oldB: BigInt(15152) * BigInt(10) ** ASSET_B.decimals,
        newA: BigInt(42) * BigInt(10) ** ASSET_A.decimals,
        newB: BigInt(132) * BigInt(10) ** ASSET_B.decimals
    }
]

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

    async function addInitialLiquidity(valueUsd5 = BigInt(1_000_000_00000)): Promise<void> {
        const tokenALiquidityDex1 = calc.convertUsd5ToToken(valueUsd5, ASSET_A.decimals, priceTokenAUsd5)
        const tokenBLiquidityDex1 = calc.convertUsd5ToToken(valueUsd5, ASSET_B.decimals, priceTokenBUsd5)
        await addLiquidity(uniswapV2, tokenA, tokenB, tokenALiquidityDex1, tokenBLiquidityDex1, signer)
        const tokenBLiquidityDex2 = calc.convertUsd5ToToken(valueUsd5, ASSET_B.decimals, priceTokenBUsd5)
        const tokenCLiquidityDex2 = calc.convertUsd5ToToken(valueUsd5, ASSET_C.decimals, priceTokenCUsd5)
        await addLiquidity(uniswapV2, tokenB, tokenC, tokenBLiquidityDex2, tokenCLiquidityDex2, signer)
        const tokenALiquidityDex3 = calc.convertUsd5ToToken(valueUsd5, ASSET_A.decimals, priceTokenAUsd5)
        const tokenCLiquidityDex3 = calc.convertUsd5ToToken(valueUsd5, ASSET_C.decimals, priceTokenCUsd5)
        await addLiquidity(uniswapV2, tokenA, tokenC, tokenALiquidityDex3, tokenCLiquidityDex3, signer)
    }

    async function getPair(tokenA: ERC20Mock, tokenB: ERC20Mock): Promise<IUniswapV2Pair> {
        const address = await uniswapV2.pairFor(tokenA, tokenB)
        return ethers.getContractAt("IUniswapV2Pair", address)
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
        tokenA = await factories.vault.deploy(ASSET_A.name, ASSET_A.symbol, ASSET_A.decimals)
        tokenB = await factories.fAsset.deploy(ASSET_B.name, ASSET_B.symbol, ASSET_B.decimals)
        tokenC = await factories.pool.deploy(ASSET_C.name, ASSET_C.symbol, ASSET_C.decimals)
    })

    describe("base functionality", () => {

        it("should add liquidity", async () => {
            // params
            const initialLiquidityTokenA = BigInt(10) ** ASSET_A.decimals
            const initialLiquidityTokenB = BigInt(10) ** ASSET_B.decimals
            const addedLiquidityTokenA = BigInt(41412) * BigInt(10) ** ASSET_A.decimals
            const addedLiquidityTokenB = BigInt(1231) * BigInt(10) ** ASSET_B.decimals
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
            const swapInA = BigInt(10) ** BigInt(ASSET_A.decimals)
            // execute test
            await addInitialLiquidity()
            const [liquidityABefore, liquidityBBefore] = await uniswapV2.getReserves(tokenA, tokenB)
            await tokenA.mint(signer, swapInA)
            await swap(uniswapV2, swapInA, [tokenA, tokenB], signer)
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
            const swapAmount = BigInt(1000)
            // add initial default liquidity
            await addInitialLiquidity()
            // amount of token A to swap ($0.01)
            const swapInA = calc.convertUsd5ToToken(swapAmount, ASSET_A.decimals, priceTokenAUsd5)
            // swap from tokenA to tokenC via tokenB
            const swapCOut = await swapOutput(uniswapV2, [tokenA, tokenB, tokenC], swapInA)
            await tokenA.connect(signer).mint(signer, swapInA)
            await swap(uniswapV2, swapInA, [tokenA, tokenB, tokenC], signer)
            // check that the minter got the right amount of tokenC
            const balanceTokenC = await tokenC.balanceOf(signer)
            expect(balanceTokenC).to.equal(swapCOut)
        })
    })

    describe("implicit dex property setters", () => {

        it("should restrict swap output if slippage is too high", async () => {
            // declare vars for multiple tests
            let minPriceMul: bigint
            let minPriceDiv: bigint
            // setup
            await addInitialLiquidity()
            const [reserveA, reserveB] = await uniswapV2.getReserves(tokenA, tokenB)
            const amountA = reserveA / BigInt(2)
            await tokenA.mint(signer, amountA)
            // can't swap our amount at zero slippage
            ;[minPriceMul, minPriceDiv] = calc.applySlippageToDexPrice(0, reserveA, reserveB)
            await expect(swap(uniswapV2, amountA, [tokenA, tokenB], signer, amountA * minPriceMul / minPriceDiv))
                .to.be.revertedWith("UniswapV2: INSUFFICIENT_OUTPUT_AMOUNT")
            // can't swap at too low slippage of 0.1%
            ;[minPriceMul, minPriceDiv] = calc.applySlippageToDexPrice(10, reserveA, reserveB)
            await expect(swap(uniswapV2, amountA, [tokenA, tokenB], signer, amountA * minPriceMul / minPriceDiv))
                .to.be.revertedWith("UniswapV2: INSUFFICIENT_OUTPUT_AMOUNT")
            // can't swap at slippage a little below max
            const slippage = calc.slippageBipsFromSwapAmountIn(amountA, reserveA, reserveB)
            ;[minPriceMul, minPriceDiv] = calc.applySlippageToDexPrice(Number(slippage) - 1, reserveA, reserveB)
            await expect(swap(uniswapV2, amountA, [tokenA, tokenB], signer, amountA * minPriceMul / minPriceDiv))
                .to.be.revertedWith("UniswapV2: INSUFFICIENT_OUTPUT_AMOUNT")
            // can swap at slippage a little above max
            ;[minPriceMul, minPriceDiv] = calc.applySlippageToDexPrice(Number(slippage) + 1, reserveA, reserveB)
            const amountB = await swapOutput(uniswapV2, [tokenA, tokenB], amountA)
            await swap(uniswapV2, amountA, [tokenA, tokenB], signer, amountA * minPriceMul / minPriceDiv)
            const balanceB = await tokenB.balanceOf(signer)
            expect(balanceB).to.equal(amountB)
        })

        it("should swap on dex to achieve a given reserve ratio", async () => {
            // params
            const desiredRatioA = BigInt(15100)
            const desiredRatioB = BigInt(1400)
            // execute test
            await addInitialLiquidity()
            await swapToRatio(uniswapV2, tokenA, tokenB, desiredRatioA, desiredRatioB, signer)
            const [reserveA, reserveB] = await uniswapV2.getReserves(tokenA, tokenB)
            const error = desiredRatioB * reserveA - desiredRatioA * reserveB
            expect(error).to.be.below(isqrt(reserveA * reserveB))
        })

        it("should swap on dex to achieve given price", async () => {
            // params
            const priceDecimals = BigInt(18)
            const precision = BigInt(1e1)
            const valueUsd5 = BigInt(51513534)
            const swappedTokenA = BigInt(1e3) * BigInt(10) ** ASSET_A.decimals
            // execute test
            await addInitialLiquidity(valueUsd5)
            await tokenA.mint(signer, swappedTokenA)
            await swap(uniswapV2, swappedTokenA, [tokenA, tokenB], signer) // ruin the dex price
            await swapToPrice(uniswapV2, tokenA, tokenB, priceTokenAUsd5, priceTokenBUsd5, ASSET_A.decimals, ASSET_B.decimals, signer)
            // check that reserves produce the right price
            const [reserveA, reserveB] = await uniswapV2.getReserves(tokenA, tokenB)
            const [wPriceA, wPriceB] = calc.relativeFormalPriceMulDiv(priceTokenAUsd5, priceTokenBUsd5, ASSET_A.decimals, ASSET_B.decimals)
            const priceMultiplier = BigInt(10) ** priceDecimals
            const realPrice = priceMultiplier * wPriceA / wPriceB
            const dexPrice = priceMultiplier * reserveB / reserveA
            expect(dexPrice).to.be.approximately(realPrice, precision)
        })

        RESERVE_CHANGE_FIXTURE.forEach(reserve => {
            it("should combine swapping with adding liquidity to produce given dex reserves", async () => {
                // execute test
                await addLiquidity(uniswapV2, tokenA, tokenB, reserve.oldA, reserve.oldB, signer)
                const [_oldReservesA, _oldReservesB] = await uniswapV2.getReserves(tokenA, tokenB)
                expect(_oldReservesA).to.equal(reserve.oldA)
                expect(_oldReservesB).to.equal(reserve.oldB)
                const pair = await getPair(tokenA, tokenB)
                await swapAndChangeLiquidityToGetReserves(uniswapV2, pair, tokenA, tokenB, reserve.newA, reserve.newB, signer)
                const [reserveA, reserveB] = await uniswapV2.getReserves(tokenA, tokenB)
                expect(reserveA).to.be.approximately(reserve.newA, isqrt(reserve.newA) / BigInt(100))
                expect(reserveB).to.be.approximately(reserve.newB, isqrt(reserve.newB) / BigInt(100))
            })
        })

        it("should produce a specified slippage rate on the dex", async () => {
            // params
            const slippageVolume = BigInt(1e6) * BigInt(10) ** ASSET_A.decimals
            const slippageBips = 50 // .5%
            // add initial liquidity
            await addInitialLiquidity()
            // add liquidity to reflect the slippage at given volume
            const pair = await getPair(tokenA, tokenB)
            await changeLiquidityToProduceSlippage(uniswapV2, pair, tokenA, tokenB, slippageBips, slippageVolume, signer)
            // theoretically check that the slippage was correct
            const [newReserveA, newReserveB] = await uniswapV2.getReserves(tokenA, tokenB)
            const theoreticalSlippageBips = calc.slippageBipsFromSwapAmountIn(slippageVolume, newReserveA, newReserveB)
            expect(theoreticalSlippageBips).to.be.approximately(slippageBips, 10)
            // check that the slippage was correct
            await tokenA.mint(signer, slippageVolume)
            await swap(uniswapV2, slippageVolume, [tokenA, tokenB], signer)
            const obtainedTokenB = await tokenB.balanceOf(signer)
            const practicalSlippageBips = calc.slippageBipsFromSwapAmountOut(obtainedTokenB, newReserveA, newReserveB)
            expect(practicalSlippageBips).to.be.approximately(slippageBips, 10)
        })
    })
})