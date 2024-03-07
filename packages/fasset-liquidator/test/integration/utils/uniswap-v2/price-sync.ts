import { priceBasedAddedDexReserves, swapToDexPrice, addedliquidityFromSlippage } from "../../../calculations"
import { addLiquidity, swap, safelyGetReserves, removeLiquidity } from "./wrappers"
import type { JsonRpcProvider, Signer } from "ethers"
import type { IERC20Metadata, IPriceReader, IUniswapV2Router } from "../../../../types"


export async function addLiquidityForSlippage(
    uniswapV2: IUniswapV2Router,
    tokenA: IERC20Metadata,
    tokenB: IERC20Metadata,
    symbolA: string,
    symbolB: string,
    amountA: bigint,
    slippageBips: number,
    maxA: bigint,
    maxB: bigint,
    signer: Signer,
    provider: JsonRpcProvider,
    recursiveCall = false
): Promise<void> {
    let [reserveA, reserveB] = await safelyGetReserves(uniswapV2, tokenA, tokenB)
    let [addedA, addedB] = addedliquidityFromSlippage(amountA, slippageBips, reserveA, reserveB)
    if (addedA > 0 && addedA <= maxA && addedB > 0 && addedB <= maxB) {
        console.log(`adding liquidity to pool (${symbolA}, ${symbolB}) to produce slippage`)
        await addLiquidity(uniswapV2, tokenA, tokenB, addedA, addedB, signer, provider)
    } else if (addedA == BigInt(0) && addedB == BigInt(0)) {
        console.log(`pool (${symbolA}, ${symbolB}) is already in sync with ftso prices`)
    } else if (!recursiveCall) {
        // if anything goes wrong remove all liquidity and try again
        const oldBalanceA = await tokenA.balanceOf(signer.getAddress())
        const oldBalanceB = await tokenB.balanceOf(signer.getAddress())
        await removeLiquidity(uniswapV2, tokenA, tokenB, signer, provider)
        const newBalanceA = await tokenA.balanceOf(signer.getAddress())
        const newBalanceB = await tokenB.balanceOf(signer.getAddress())
        maxA += newBalanceA - oldBalanceA
        maxB += newBalanceB - oldBalanceB
        // try again with reserves changed
        await addLiquidityForSlippage(uniswapV2, tokenA, tokenB, symbolA, symbolB, amountA, slippageBips, maxA, maxB, signer, provider, true)
    } else {
        console.error(`unable to add liquidity to pool (${symbolA}, ${symbolB}) for specified slippage`)
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
    if ((reserveA == BigInt(0) || reserveB == BigInt(0)) && addInitialLiquidity) {
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
    let [addedA, addedB] = priceBasedAddedDexReserves(
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
        console.log(`capping desired swap of ${swapA} ${symbolA} to ${maxSwapA}`)
        swapA = maxSwapA
    }
    if (swapB > maxSwapB) {
        console.log(`capping desired swap of ${swapB} ${symbolB} to ${maxSwapB}`)
        swapB = maxSwapB
    }
    if (swapA > 0) {
        console.log(`swapping ${swapA} ${symbolA} for ${symbolB}`)
        await swap(uniswapV2, tokenA, tokenB, swapA, signer, provider)
    } else if (swapB > 0) {
        console.log(`swapping ${swapB} ${symbolB} for ${symbolA}`)
        await swap(uniswapV2, tokenB, tokenA, swapB, signer, provider)
    } else {
        console.error(`pool (${symbolA}, ${symbolB}) is already in sync with ftso prices`)
    }
}