import { priceBasedAddedDexReserves, swapToDexPrice } from "../../../calculations"
import { addLiquidity, swap } from "./wrappers"
import type { JsonRpcProvider, Signer } from "ethers"
import type { IERC20Metadata, IUniswapV2Router } from "../../../../types"
import type { Contracts } from "../interfaces/contracts"


export async function syncDexReservesWithFtsoPrices(
    contracts: Contracts,
    tokenA: IERC20Metadata,
    tokenB: IERC20Metadata,
    symbolA: string,
    symbolB: string,
    maxAddedA: bigint,
    maxAddedB: bigint,
    signer: Signer,
    provider: JsonRpcProvider,
    addInitialLiquidity = true
): Promise<void> {
    // get ftso prices of all relevant symbols
    const { 0: priceA } = await contracts.priceReader.getPrice(symbolA)
    const { 0: priceB } = await contracts.priceReader.getPrice(symbolB)
    // align f-asset/usdc and wNat/usdc dex prices with the ftso with available balances
    // by swapping
    const { 0: reserveA, 1: reserveB } = await contracts.uniswapV2.getReserves(tokenA, tokenB)
    if ((reserveA == BigInt(0) || reserveB == BigInt(0)) && addInitialLiquidity) {
        // if there are no reserves add liquidity first (also no need to swap)
        await addLiquidityToDexPairPrice(
            contracts.uniswapV2, tokenA, tokenB, priceA, priceB,
            maxAddedA, maxAddedB, signer, provider
        )
    } else if (reserveA > BigInt(0) && reserveB > BigInt(0)) {
        // if there are reserves swap first, then add liquidity
        await swapDexPairToPrice(contracts, tokenA, tokenB, priceA, priceB, maxAddedA, maxAddedB, signer, provider)
    } else {
        console.error('sync dex reserves failure: no reserves to sync')
    }
}

// (TODO: do not assume that 5 ftso decimals)
// set dex price of tokenA in tokenB by adding liquidity.
// both prices in the same currency, e.g. FLR/$, XRP/$
async function addLiquidityToDexPairPrice(
    uniswapV2: IUniswapV2Router,
    tokenA: IERC20Metadata,
    tokenB: IERC20Metadata,
    priceA: bigint,
    priceB: bigint,
    maxAddedA: bigint,
    maxAddedB: bigint,
    signer: Signer,
    provider: JsonRpcProvider
): Promise<void> {
    const decimalsA = await tokenA.decimals()
    const decimalsB = await tokenB.decimals()
    let reserveA = BigInt(0)
    let reserveB = BigInt(0)
    try {
        [reserveA, reserveB] = await uniswapV2.getReserves(tokenA, tokenB)
    } catch {
        // means there's no reserves for the dex pair
    }
    let [addedA, addedB] = priceBasedAddedDexReserves(
        reserveA, reserveB, priceA, priceB, decimalsA, decimalsB, maxAddedA, maxAddedB)
    if (addedA < 0) addedA = BigInt(0) // ideally we would need to remove liquidity
    if (addedB < 0) addedB = BigInt(0) // but user may not have any, so we leave it
    if (addedA == BigInt(0) && addedB == BigInt(0)) {
        console.error('add liquidity failure: no reserves can be added')
    } else {
        await addLiquidity(uniswapV2, tokenA, tokenB, addedA, addedB, signer, provider)
    }
}

// swap on dexes to achieve the given price
export async function swapDexPairToPrice(
    contracts: Contracts,
    tokenA: IERC20Metadata,
    tokenB: IERC20Metadata,
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
    const [reserveA, reserveB] = await contracts.uniswapV2.getReserves(tokenA, tokenB)
    let swapA = swapToDexPrice(reserveA, reserveB, priceA, priceB, decimalsA, decimalsB)
    if (swapA > maxSwapA) swapA = maxSwapA
    let swapB = swapToDexPrice(reserveB, reserveA, priceB, priceA, decimalsB, decimalsA)
    if (swapB > maxSwapB) swapB = maxSwapB
    if (swapA > 0) {
        await swap(contracts.uniswapV2, tokenA, tokenB, swapA, signer, provider)
    } else if (swapB > 0) {
        await swap(contracts.uniswapV2, tokenB, tokenA, swapB, signer, provider)
    }
}