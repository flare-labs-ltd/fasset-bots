import { priceBasedAddedDexReserves, swapToDexPrice } from "../../../calculations/calculations"
import { cappedAddedLiquidityFromSlippage, cappedReservesFromPriceAndSlippage } from '../../../calculations/slippage'
import { addLiquidity, swap, safelyGetReserves, removeLiquidity } from "./wrappers"
import { logAddedLiquidityForSlippage, logSlippageUnnecessary, logRemovingLiquidityBeforeRetrying, logUnableToProduceSlippage, logCappingDesiredSwapAmount, logSwapping } from "./log-format"
import type { JsonRpcProvider, Signer } from "ethers"
import type { IERC20Metadata, IPriceReader, IUniswapV2Router } from "../../../../types"


export async function adjustLiquidityForSlippage(
    uniswapV2: IUniswapV2Router,
    priceReader: IPriceReader,
    tokenA: IERC20Metadata,
    tokenB: IERC20Metadata,
    symbolA: string,
    symbolB: string,
    maxA: bigint,
    maxB: bigint,
    amountA: bigint,
    slippageBips: number,
    signer: Signer,
    provider: JsonRpcProvider,
    recursiveCall = false
): Promise<void> {
    const decimalsA = await tokenA.decimals()
    const decimalsB = await tokenB.decimals()
    const [reserveA, reserveB] = await safelyGetReserves(uniswapV2, tokenA, tokenB)
    let [addedA, addedB]: [bigint, bigint] = [BigInt(0), BigInt(0)]
    if (reserveA == BigInt(0) || reserveB == BigInt(0)) {
        const { 0: priceA, 2: ftsoDecimalsA } = await priceReader.getPrice(symbolA)
        const { 0: priceB, 2: ftsoDecimalsB } = await priceReader.getPrice(symbolB)
        if (ftsoDecimalsA != BigInt(5) || ftsoDecimalsB != BigInt(5))
            throw Error("Token price has non-5 ftso decimals")
            ;[addedA, addedB] = cappedReservesFromPriceAndSlippage(amountA, slippageBips, maxA, maxB, priceA, priceB, decimalsA, decimalsB)
    } else {
        [addedA, addedB] = cappedAddedLiquidityFromSlippage(amountA, slippageBips, maxA, maxB, reserveA, reserveB)
    }
    if (addedA > 0 && addedA <= maxA && addedB > 0 && addedB <= maxB) {
        logAddedLiquidityForSlippage(addedA, addedB, slippageBips, amountA, symbolA, symbolB, decimalsA, decimalsB)
        await addLiquidity(uniswapV2, tokenA, tokenB, addedA, addedB, signer, provider)
    } else if (addedA == BigInt(0) && addedB == BigInt(0)) {
        logSlippageUnnecessary(slippageBips, amountA, maxA, maxB, symbolA, symbolB, decimalsA, decimalsB)
    } else if (reserveA > BigInt(0) && reserveB > BigInt(0) && !recursiveCall) {
        // if anything goes wrong remove all liquidity and try again
        logRemovingLiquidityBeforeRetrying(symbolA, symbolB)
        const [removedA, removedB] = await removeLiquidity(uniswapV2, tokenA, tokenB, signer, provider)
        if (removedA == BigInt(0) && removedB == BigInt(0)) {
            return logUnableToProduceSlippage(addedA, addedB, slippageBips, amountA, symbolA, symbolB, decimalsA, decimalsB)
        }
        // try again with reserves changed
        await adjustLiquidityForSlippage(
            uniswapV2, priceReader, tokenA, tokenB, symbolA, symbolB,
            maxA + removedA, maxB + removedB, amountA, slippageBips,
            signer, provider, true)
    } else {
        logUnableToProduceSlippage(addedA, addedB, slippageBips, amountA, symbolA, symbolB, decimalsA, decimalsB)
    }
}

export async function syncDexReservesWithFtsoPrices(
    uniswapV2: IUniswapV2Router,
    priceReader: IPriceReader,
    tokenA: IERC20Metadata,
    tokenB: IERC20Metadata,
    symbolA: string,
    symbolB: string,
    maxA: bigint,
    maxB: bigint,
    signer: Signer,
    provider: JsonRpcProvider,
    addInitialLiquidity = true
): Promise<void> {
    // get ftso prices of all relevant symbols
    const { 0: priceA, 2: decimalsA } = await priceReader.getPrice(symbolA)
    const { 0: priceB, 2: decimalsB } = await priceReader.getPrice(symbolB)
    if (decimalsA != BigInt(5) || decimalsB != BigInt(5)) throw Error("Token price has non-5 ftso decimals")
    // align f-asset/usdc and wNat/usdc dex prices with the ftso with available balances by swapping
    const [reserveA, reserveB] = await safelyGetReserves(uniswapV2, tokenA, tokenB)
    if ((reserveA == BigInt(0) && reserveB == BigInt(0)) && addInitialLiquidity) {
        // if there are no reserves add liquidity first (also no need to swap)
        await addLiquidityToDexPairPrice(
            uniswapV2, tokenA, tokenB, symbolA, symbolB, priceA, priceB,
            maxA, maxB, signer, provider
        )
    } else if (reserveA > BigInt(0) && reserveB > BigInt(0)) {
        // if there are reserves swap first, then add liquidity
        await swapDexPairToPrice(uniswapV2, tokenA, tokenB, symbolA, symbolB, priceA, priceB, maxA, maxB, signer, provider)
    } else {
        console.error('sync dex reserves: no reserves to sync')
    }
}

// (TODO: do not assume that 5 ftso decimals)
// set dex price of tokenA in tokenB by adding liquidity.
// both prices in the same currency, e.g. FLR/$, XRP/$
async function addLiquidityToDexPairPrice(
    uniswapV2: IUniswapV2Router,
    tokenA: IERC20Metadata,
    tokenB: IERC20Metadata,
    symbolA: string,
    symbolB: string,
    priceA: bigint,
    priceB: bigint,
    maxAddedA: bigint,
    maxAddedB: bigint,
    signer: Signer,
    provider: JsonRpcProvider
): Promise<void> {
    const decimalsA = await tokenA.decimals()
    const decimalsB = await tokenB.decimals()
    const [reserveA, reserveB] = await safelyGetReserves(uniswapV2, tokenA, tokenB)
    const [addedA, addedB] = priceBasedAddedDexReserves(
        reserveA, reserveB, priceA, priceB, decimalsA, decimalsB, maxAddedA, maxAddedB)
    if (addedA < 0 || addedB < 0) {
        console.log(`cannot add liquidity to pool (${symbolA}, ${symbolB}) to match ftso prices, swapping required`)
    } else if (addedA > 0 && addedB > 0) {
        console.log(`adding liquidity to pool (${symbolA}, ${symbolB}) to match ftso prices`)
        await addLiquidity(uniswapV2, tokenA, tokenB, addedA, addedB, signer, provider)
    } else {
        console.error(`pool (${symbolA}, ${symbolB}) is already in sync with ftso prices`)
    }
}

// swap on dexes to achieve the given price
export async function swapDexPairToPrice(
    uniswapV2: IUniswapV2Router,
    tokenA: IERC20Metadata,
    tokenB: IERC20Metadata,
    symbolA: string,
    symbolB: string,
    priceA: bigint,
    priceB: bigint,
    maxSwapA: bigint,
    maxSwapB: bigint,
    signer: Signer,
    provider: JsonRpcProvider
): Promise<void> {
    // align dex prices with the ftso prices while not exceeding available balances
    const decimalsA = await tokenA.decimals()
    const decimalsB = await tokenB.decimals()
    const [reserveA, reserveB] = await uniswapV2.getReserves(tokenA, tokenB)
    let swapA = swapToDexPrice(reserveA, reserveB, priceA, priceB, decimalsA, decimalsB)
    let swapB = swapToDexPrice(reserveB, reserveA, priceB, priceA, decimalsB, decimalsA)
    if (swapA > maxSwapA) {
        logCappingDesiredSwapAmount(swapA, maxSwapA, symbolA, decimalsA)
        swapA = maxSwapA
    }
    if (swapB > maxSwapB) {
        logCappingDesiredSwapAmount(swapB, maxSwapB, symbolB, decimalsB)
        swapB = maxSwapB
    }
    if (swapA > 0) {
        logSwapping(swapA, symbolA, symbolB, decimalsA)
        await swap(uniswapV2, tokenA, tokenB, swapA, signer, provider)
    } else if (swapB > 0) {
        logSwapping(swapB, symbolB, symbolA, decimalsB)
        await swap(uniswapV2, tokenB, tokenA, swapB, signer, provider)
    } else {
        console.error(`pool (${symbolA}, ${symbolB}) is already in sync with ftso prices`)
    }
}
