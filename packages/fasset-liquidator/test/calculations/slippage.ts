import { DEX_FACTOR_BIPS, DEX_MAX_BIPS, FASSET_MAX_BIPS } from "../constants"
import { relativeFormalPriceMulDiv } from "./calculations"

/**
 Slippage is around p / (1 - p) where p is the ratio of the traded volume to the reserve
 So, if trading volume is 1% of the reserve, then slippage is around 1 / 99 ~ 1.01%.
 If percentage of the reserve is small, then slippage is close to the percentage of the reserve.
 */


// the amount of liquidity to add that produces
// the given price slippage when swapping amountA
export function addedLiquidityFromSlippage(
    amountA: bigint,
    slippageBips: number,
    reserveA: bigint,
    reserveB: bigint
): [bigint, bigint] {
    const [newReserveA, newReserveB] = reservesFromRatioAndSlippage(amountA, slippageBips, reserveA, reserveB)
    return [newReserveA - reserveA, newReserveB - reserveB]
}

export function reservesFromPriceAndSlippage(
    amountA: bigint,
    slippageBips: number,
    priceA: bigint,
    priceB: bigint,
    decimalsA: bigint,
    decimalsB: bigint
): [bigint, bigint] {
    const [ratioB, ratioA] = relativeFormalPriceMulDiv(priceA, priceB, decimalsA, decimalsB)
    return reservesFromRatioAndSlippage(amountA, slippageBips, ratioA, ratioB)
}

export function reservesFromRatioAndSlippage(
    amountA: bigint,
    slippageBips: number,
    ratioA: bigint,
    ratioB: bigint
): [bigint, bigint] {
    const reserveA = reserveFromSlippage(amountA, slippageBips)
    const reserveB = reserveA * ratioB / ratioA
    return [reserveA, reserveB]
}

// slippage along with traded volume defines reserveA value
export function reserveFromSlippage(
    amountA: bigint,
    slippageBips: number
): bigint {
    const slippageFactor = FASSET_MAX_BIPS - BigInt(slippageBips)
    const adjustedDexFactor = DEX_FACTOR_BIPS * FASSET_MAX_BIPS / DEX_MAX_BIPS
    return amountA * adjustedDexFactor * slippageFactor
        / (adjustedDexFactor - slippageFactor) / FASSET_MAX_BIPS
}

export function cappedAddedLiquidityFromSlippage(
    amountA: bigint,
    slippageBips: number,
    maxAddedA: bigint,
    maxAddedB: bigint,
    reserveA: bigint,
    reserveB: bigint
): [bigint, bigint] {
    const [newReserveA, newReserveB] = cappedReservesFromSlippage(
        amountA, slippageBips, reserveA + maxAddedA, reserveB + maxAddedB, reserveA, reserveB)
    return [newReserveA - reserveA, newReserveB - reserveB]
}

export function cappedReservesFromPriceAndSlippage(
    amountA: bigint,
    slippageBips: number,
    maxReserveA: bigint,
    maxReserveB: bigint,
    priceA: bigint,
    priceB: bigint,
    decimalsA: bigint,
    decimalsB: bigint
): [bigint, bigint] {
    const [ratioB, ratioA] = relativeFormalPriceMulDiv(priceA, priceB, decimalsA, decimalsB)
    return cappedReservesFromSlippage(amountA, slippageBips, maxReserveA, maxReserveB, ratioA, ratioB)
}

export function cappedReservesFromSlippage(
    amountA: bigint,
    slippageBips: number,
    maxReserveA: bigint,
    maxReserveB: bigint,
    ratioA: bigint,
    ratioB: bigint
): [bigint, bigint] {
    const [reserveA, reserveB] = reservesFromRatioAndSlippage(amountA, slippageBips, ratioA, ratioB)
    if (reserveA <= maxReserveA && reserveB <= maxReserveB) {
        return [reserveA, reserveB]
    }
    const fallbackReserveB = maxReserveA * ratioB / ratioA
    if (fallbackReserveB <= maxReserveB) {
        return [maxReserveA, fallbackReserveB]
    } else {
        const fallbackReserveA = maxReserveB * ratioA / ratioB
        return [fallbackReserveA, maxReserveB]
    }
}