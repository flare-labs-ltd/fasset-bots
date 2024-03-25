import { ethers } from 'hardhat'
import { expect } from 'chai'
import { isqrt, randBigInt } from '../utils'
import * as calc from '../calculations/calculations'
import { reservesFromPriceAndSlippage, cappedReservesFromPriceAndSlippage, cappedAddedLiquidityFromSlippage } from '../calculations/slippage'
import { addLiquidity, swap, swapOutput, swapToRatio, swapToPrice, changeLiquidityToProduceSlippage, swapAndChangeLiquidityToGetReserves } from './utils/uniswap-v2'
import deployUniswapV2 from './fixtures/dexes'
import { getFactories } from './fixtures/context'
import { FASSET_MAX_BIPS, PRICE_PRECISION } from '../constants'
import { XRP, USDT, WETH, WFLR } from './fixtures/assets'
import type { HardhatEthersSigner } from '@nomicfoundation/hardhat-ethers/signers'
import type { IUniswapV2Router, IUniswapV2Pair, ERC20Mock } from '../../types'


const PRICE_MAX_ERROR = PRICE_PRECISION / BigInt(1e5) // price is accurate to the point of FTSO error of 5 decimals
const SLIPPAGE_MAX_ERROR = 10

const ASSET_A = USDT
const ASSET_B = XRP
const ASSET_C = WETH

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
    // set before each
    let accounts: HardhatEthersSigner[]
    let signer: HardhatEthersSigner
    let wNat: ERC20Mock
    let uniswapV2: IUniswapV2Router
    let tokenA: ERC20Mock
    let tokenB: ERC20Mock
    let tokenC: ERC20Mock

    async function addInitialLiquidity(valueUsd5 = BigInt(1_000_000_00000)): Promise<void> {
        const tokenALiquidityDex1 = calc.convertUsd5ToToken(valueUsd5, ASSET_A.decimals, ASSET_A.defaultPriceUsd5)
        const tokenBLiquidityDex1 = calc.convertUsd5ToToken(valueUsd5, ASSET_B.decimals, ASSET_B.defaultPriceUsd5)
        await addLiquidity(uniswapV2, tokenA, tokenB, tokenALiquidityDex1, tokenBLiquidityDex1, signer)
        const tokenBLiquidityDex2 = calc.convertUsd5ToToken(valueUsd5, ASSET_B.decimals, ASSET_B.defaultPriceUsd5)
        const tokenCLiquidityDex2 = calc.convertUsd5ToToken(valueUsd5, ASSET_C.decimals, ASSET_C.defaultPriceUsd5)
        await addLiquidity(uniswapV2, tokenB, tokenC, tokenBLiquidityDex2, tokenCLiquidityDex2, signer)
        const tokenALiquidityDex3 = calc.convertUsd5ToToken(valueUsd5, ASSET_A.decimals, ASSET_A.defaultPriceUsd5)
        const tokenCLiquidityDex3 = calc.convertUsd5ToToken(valueUsd5, ASSET_C.decimals, ASSET_C.defaultPriceUsd5)
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
            const swapInA = calc.convertUsd5ToToken(swapAmount, ASSET_A.decimals, ASSET_A.defaultPriceUsd5)
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
            const valueUsd5 = BigInt(51513534)
            const swappedTokenA = BigInt(1e3) * BigInt(10) ** ASSET_A.decimals
            // execute test
            await addInitialLiquidity(valueUsd5)
            await tokenA.mint(signer, swappedTokenA)
            await swap(uniswapV2, swappedTokenA, [tokenA, tokenB], signer) // ruin the dex price
            await swapToPrice(uniswapV2, tokenA, tokenB, ASSET_A.defaultPriceUsd5, ASSET_B.defaultPriceUsd5, ASSET_A.decimals, ASSET_B.decimals, signer)
            // check that reserves produce the right price
            const [reserveA, reserveB] = await uniswapV2.getReserves(tokenA, tokenB)
            expect(calc.relativeTokenPrice(ASSET_A.defaultPriceUsd5, ASSET_B.defaultPriceUsd5)).to.be.approximately(
                calc.relativeTokenDexPrice(reserveA, reserveB, ASSET_A.decimals, ASSET_B.decimals), PRICE_MAX_ERROR)
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

        describe("slippage", () => {
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
                const slippage = calc.slippageBipsFromSwapAmountIn(amountA, reserveA)
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

            it("should produce a specified slippage rate on the dex while keeping price the same", async () => {
                // params
                const slippageVolume = BigInt(1e6) * BigInt(10) ** ASSET_A.decimals
                const slippageBips = 40 // .5%
                // add initial liquidity
                await addInitialLiquidity()
                // add liquidity to reflect the slippage at given volume
                const pair = await getPair(tokenA, tokenB)
                await changeLiquidityToProduceSlippage(uniswapV2, pair, tokenA, tokenB, slippageBips, slippageVolume, signer)
                // theoretically check that the slippage was correct
                const [newReserveA,] = await uniswapV2.getReserves(tokenA, tokenB)
                const theoreticalSlippageBips = calc.slippageBipsFromSwapAmountIn(slippageVolume, newReserveA)
                expect(theoreticalSlippageBips).to.be.approximately(slippageBips, SLIPPAGE_MAX_ERROR)
            })

            it("should produce a specified slippage rate on a newly liquidated dex", async () => {
                // params
                const slippageVolume = BigInt(232411241) * BigInt(10) ** ASSET_A.decimals
                const slippageBips = 1000 // 10%
                // add liquidity
                const [reserveA, reserveB] = reservesFromPriceAndSlippage(
                    slippageVolume, slippageBips, ASSET_A.defaultPriceUsd5, ASSET_B.defaultPriceUsd5, ASSET_A.decimals, ASSET_B.decimals)
                await addLiquidity(uniswapV2, tokenA, tokenB, reserveA, reserveB, signer)
                const [realReserveA, realReserveB] = await uniswapV2.getReserves(tokenA, tokenB)
                expect(calc.relativeTokenPrice(ASSET_A.defaultPriceUsd5, ASSET_B.defaultPriceUsd5)).to.be.approximately(
                    calc.relativeTokenDexPrice(realReserveA, realReserveB, ASSET_A.decimals, ASSET_B.decimals), PRICE_MAX_ERROR)
                const theoreticalSlippageBips = calc.slippageBipsFromSwapAmountIn(slippageVolume, reserveA)
                expect(theoreticalSlippageBips).to.be.approximately(slippageBips, SLIPPAGE_MAX_ERROR)
            })
        })

        describe("calculations", () => {
            const ntests = 1000

            it("should correctly calculate capped reserves from price and desired slippage", () => {
                const balanceA = BigInt(1e6) * BigInt(10) ** ASSET_A.decimals
                const balanceB = BigInt(1e6) * BigInt(10) ** ASSET_B.decimals
                for (let i = 0; i < ntests; i++) {
                    const amountA = randBigInt(BigInt(10) ** ASSET_A.decimals, balanceA / BigInt(100))
                    const slippageBips = randBigInt(FASSET_MAX_BIPS / BigInt(100), FASSET_MAX_BIPS / BigInt(2))
                    const [reserveA, reserveB] = cappedReservesFromPriceAndSlippage(
                        amountA,
                        Number(slippageBips),
                        balanceA,
                        balanceB,
                        ASSET_A.defaultPriceUsd5,
                        ASSET_B.defaultPriceUsd5,
                        ASSET_A.decimals,
                        ASSET_B.decimals
                    )
                    const calcSlippage = calc.slippageBipsFromSwapAmountIn(amountA, reserveA)
                    expect(reserveA).to.be.lessThanOrEqual(balanceA)
                    expect(reserveB).to.be.lessThanOrEqual(balanceB)
                    expect(calc.relativeTokenDexPrice(reserveA, reserveB, ASSET_A.decimals, ASSET_B.decimals)).to.be.approximately(
                        calc.relativeTokenPrice(ASSET_A.defaultPriceUsd5, ASSET_B.defaultPriceUsd5), PRICE_MAX_ERROR)
                    if (reserveA == balanceA || reserveB == balanceB) {
                        // if calculation capped reserves, then we expect slippage to be higher,
                        // because higher slippage corresponds to less reserves
                        expect(calcSlippage).to.be.greaterThanOrEqual(slippageBips)
                    } else {
                        expect(calcSlippage).to.be.approximately(slippageBips, SLIPPAGE_MAX_ERROR)
                    }
                }
            })

            it("should correctly calculate added liquidity from reserves and slippage", () => {
                const balanceA = BigInt(1e6) * BigInt(10) ** ASSET_A.decimals
                const balanceB = BigInt(1e6) * BigInt(10) ** ASSET_B.decimals
                const reserveA = BigInt(1e2) * BigInt(10) ** ASSET_A.decimals
                for (let i = 0; i < ntests; i++) {
                    const amountA = randBigInt(BigInt(10) ** ASSET_A.decimals, balanceA / BigInt(100))
                    const slippageBips = randBigInt(FASSET_MAX_BIPS / BigInt(100), FASSET_MAX_BIPS / BigInt(2))
                    const reserveB = calc.priceBasedInitialDexReserve(
                        ASSET_A.defaultPriceUsd5,
                        ASSET_B.defaultPriceUsd5,
                        ASSET_A.decimals,
                        ASSET_B.decimals,
                        reserveA
                    )
                    const [addedA, addedB] = cappedAddedLiquidityFromSlippage(
                        amountA,
                        Number(slippageBips),
                        balanceA - reserveA,
                        balanceB - reserveB,
                        reserveA,
                        reserveB
                    )
                    const newReserveA = reserveA + addedA
                    const newReserveB = reserveB + addedB
                    const calcSlippage = calc.slippageBipsFromSwapAmountIn(amountA, newReserveA)
                    expect(addedA).to.be.lessThanOrEqual(balanceA - reserveA)
                    expect(reserveB).to.be.lessThanOrEqual(balanceB - reserveB)
                    expect(calc.relativeTokenDexPrice(newReserveA, newReserveB, ASSET_A.decimals, ASSET_B.decimals)).to.be.approximately(
                        calc.relativeTokenPrice(ASSET_A.defaultPriceUsd5, ASSET_B.defaultPriceUsd5), PRICE_MAX_ERROR)
                    if (addedA == balanceA - reserveA || addedB == balanceB - reserveB) {
                        // if calculation capped reserves, then we expect slippage to be higher,
                        // because higher slippage corresponds to less reserves
                        expect(calcSlippage).to.be.greaterThanOrEqual(slippageBips)
                    } else {
                        expect(calcSlippage).to.be.approximately(slippageBips, SLIPPAGE_MAX_ERROR)
                    }
                }
            })

        })
    })
})
