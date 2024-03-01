import { AMG_TOKEN_WEI_PRICE_SCALE, AMG_TOKEN_WEI_PRICE_SCALE_EXP, DEX_FACTOR_BIPS, DEX_MAX_BIPS, FASSET_MAX_BIPS } from "./constants"
import { isqrt } from "./unit/utils/bigint"

////////////////////////////////////////////////////////////////////////////
// conversions

export function convertUsd5ToToken(
    amountUsd5: bigint,
    tokenDecimals: bigint,
    tokenPriceUsd5: bigint
): bigint {
    return amountUsd5 * BigInt(10) ** tokenDecimals / tokenPriceUsd5
}

export function roundUpWithPrecision(
    amount: bigint,
    precision: bigint
): bigint {
    const aux = amount % precision
    return (aux == BigInt(0)) ? amount : amount + precision - aux
}

export function priceAB(
    priceA: bigint,
    priceB: bigint,
    decimalsA: bigint,
    decimalsB: bigint
): [bigint, bigint] {
    return [
        priceA * BigInt(10) ** decimalsB,
        priceB * BigInt(10) ** decimalsA
    ]
}

////////////////////////////////////////////////////////////////////////////
// uniswap v2 formulas

// calculates the amount of tokenB received
// when swapping amountA of tokenA
export function swapOutput(
    amountA: bigint,
    reserveA: bigint,
    reserveB: bigint
): bigint {
    const amountAWithFee = DEX_FACTOR_BIPS * amountA
    const numerator = amountAWithFee * reserveB
    const denominator = DEX_MAX_BIPS * reserveA + amountAWithFee
    return numerator / denominator
}

// calculates the amount of tokenB needed
// to swap to obtain amountA of tokenIn
export function swapInput(
    amountB: bigint,
    reserveA: bigint,
    reserveB: bigint
): bigint {
    const numerator = DEX_MAX_BIPS * reserveA * amountB
    const denominator = DEX_FACTOR_BIPS * (reserveB - amountB)
    return numerator / denominator + BigInt(1)
}

// calculates the amount of tokenB needed
// to swap to obtain amountA of tokenIn,
// where swapping is done along a token path
// with provided reserves
export function swapInputs(
    amountOut: bigint,
    reserves: [bigint, bigint][]
): bigint {
    let amountIn = amountOut
    for (let i = reserves.length; i > 0; i--) {
        const [reserveA, reserveB] = reserves[i - 1]
        amountIn = swapInput(amountIn, reserveA, reserveB)
    }
    return amountIn
}

// for consecutive swaps that affect the following ones
// so we have to track and adjust the reserves
export function consecutiveSwapOutputs(
    amountsIn: bigint[],
    paths: string[][],
    reserves: [bigint, bigint][][]
): bigint[] {
    const amountsOut = amountsIn.slice()
    for (let i = 0; i < paths.length; i++) {
        const path = paths[i]
        const reserve = reserves[i]
        for (let j = 1; j < path.length; j++) {
            // liquidity pool path[j-1] / path[j]
            const [resA, resB] = reserve[j - 1]
            const aux = swapOutput(amountsOut[i], resA, resB)
            for (let k = i + 1; k < paths.length; k++) {
                // liquidity pool paths[k][j-1] / paths[k][j]
                const pathToModify = paths[k]
                for (let l = 1; l < pathToModify.length; l++) {
                    if (pathToModify[l - 1] == path[j - 1] && pathToModify[l] == path[j]) {
                        reserves[k][l - 1][0] += amountsOut[i]
                        reserves[k][l - 1][1] -= aux
                    } else if (pathToModify[l - 1] == path[j] && pathToModify[l] == path[j - 1]) {
                        reserves[k][l - 1][0] -= aux
                        reserves[k][l - 1][1] += amountsOut[i]
                    }
                }
            }
            amountsOut[i] = aux
        }
    }
    return amountsOut
}

export function liquidityOut(
    liquidity: bigint,
    totalLiquidity: bigint,
    reserve: bigint
): bigint {
    return liquidity * reserve / totalLiquidity
}

// exact liquidity to be deposited
export function optimalAddedLiquidity(
    reserveA: bigint,
    reserveB: bigint,
    addedA: bigint,
    addedB: bigint
): [bigint, bigint] {
    const exactAddedA = addedB * reserveA / reserveB
    if (exactAddedA <= addedA) {
        return [exactAddedA, addedB]
    } else {
        const exactAddedB = addedA * reserveB / reserveA
        return [addedA, exactAddedB]
    }
}

// define slippage from swapping amountA
export function slippageBipsFromSwapAmountIn(
    amountA: bigint,
    reserveA: bigint,
    reserveB: bigint
): bigint {
    const amountB = swapOutput(amountA, reserveA, reserveB)
    const slippageFactorBips = FASSET_MAX_BIPS * amountB * reserveA / (amountA * reserveB)
    return FASSET_MAX_BIPS - slippageFactorBips
}

// slippage from receiving amountB when swapping through
// liquidity pool with reserves reserveA and reserveB
export function slippageBipsFromSwapAmountOut(
    amountB: bigint,
    reserveA: bigint,
    reserveB: bigint
): bigint {
    const amountA = swapInput(amountB, reserveA, reserveB)
    return slippageBipsFromSwapAmountIn(amountA, reserveA, reserveB)
}

////////////////////////////////////////////////////////////////////////////
// implicit ecosystem setters

// get tokenA/tokenB reserve, based on
// the prices that they should have and
// tokenB/tokenA reserve
// prices should be in the same currency,
// e.g. FLR/$, XRP/$
export function priceBasedInitialDexReserve(
    priceA: bigint,
    priceB: bigint,
    decimalsA: bigint,
    decimalsB: bigint,
    reserveA: bigint,
): bigint {
    // reserveB / reserveA = priceA / priceB
    return reserveA
        * priceA
        * BigInt(10) ** decimalsB
        / BigInt(10) ** decimalsA
        / priceB
}

// prices are in some same currency
export function collateralForAgentCr(
    crBips: bigint,
    totalMintedUBA: bigint,
    priceFAsset: bigint,
    priceCollateral: bigint,
    decimalsFAsset: bigint,
    decimalsCollateral: bigint
): bigint {
    return totalMintedUBA
        * priceFAsset
        * BigInt(10) ** decimalsCollateral
        * crBips
        / priceCollateral
        / BigInt(10) ** decimalsFAsset
        / FASSET_MAX_BIPS
}

// get the asset price that results in given
// given collateral ratio for the agent
export function assetPriceForAgentCr(
    crBips: bigint,
    totalMintedUBA: bigint,
    collateralWei: bigint,
    collateralFtsoPrice: bigint,
    collateralFtsoDecimals: bigint,
    collateralTokenDecimals: bigint,
    fAssetFtsoDecimals: bigint,
    fAssetTokenDecimals: bigint
): bigint {
    const expPlus = fAssetTokenDecimals + fAssetFtsoDecimals
    const expMinus = collateralTokenDecimals + collateralFtsoDecimals
    return BigInt(10) ** expPlus
        * collateralFtsoPrice
        * collateralWei
        * FASSET_MAX_BIPS
        / BigInt(10) ** expMinus
        / crBips
        / totalMintedUBA
}

// returns the maximal reserves that can be added to a dex,
// with some initial reserves, that produce the given price on
// that dex (see priceBasedDexReserve)
export function priceBasedAddedDexReserves(
    initialReserveA: bigint,
    initialReserveB: bigint,
    priceA: bigint,
    priceB: bigint,
    decimalsA: bigint,
    decimalsB: bigint,
    maxAddedA: bigint,
    maxAddedB: bigint
): [bigint, bigint] {
    const [ratioB, ratioA] = priceAB(priceA, priceB, decimalsA, decimalsB)
    const factorA = FASSET_MAX_BIPS * (maxAddedA + initialReserveA) / ratioA
    const factorB = FASSET_MAX_BIPS * (maxAddedB + initialReserveB) / ratioB
    const factor = (factorA < factorB) ? factorA : factorB
    const addedA = factor * ratioA / FASSET_MAX_BIPS - initialReserveA
    const addedB = factor * ratioB / FASSET_MAX_BIPS - initialReserveB
    return [addedA, addedB]
}

export function swapToDexPrice(
    initialReserveA: bigint,
    initialReserveB: bigint,
    priceA: bigint,
    priceB: bigint,
    decimalsA: bigint,
    decimalsB: bigint
): bigint {
    const [priceABMul, priceABDiv] = priceAB(priceA, priceB, decimalsA, decimalsB)
    return swapToDexRatio(initialReserveA, initialReserveB, priceABDiv, priceABMul)
}

export function swapToDexRatio(
    initialReserveA: bigint,
    initialReserveB: bigint,
    desiredRatioA: bigint,
    desiredRatioB: bigint
): bigint {
    const aux1 = BigInt(4) * initialReserveB * desiredRatioA * DEX_FACTOR_BIPS / DEX_MAX_BIPS
    const aux2 = initialReserveA * desiredRatioB * (DEX_FACTOR_BIPS - DEX_MAX_BIPS) ** BigInt(2) / DEX_MAX_BIPS ** BigInt(2)
    const aux3 = isqrt(initialReserveA * (aux1 + aux2) / desiredRatioB)

    const aux4 = initialReserveA * (DEX_FACTOR_BIPS + DEX_MAX_BIPS) / DEX_MAX_BIPS
    return (aux3 - aux4) * DEX_MAX_BIPS / (BigInt(2) * DEX_FACTOR_BIPS)
}

export function applySlippageToDexPrice(
    maxSlippageBips: number,
    reserveA: bigint,
    reserveB: bigint
): [bigint, bigint] {
    return [reserveB * (FASSET_MAX_BIPS - BigInt(maxSlippageBips)), FASSET_MAX_BIPS * reserveA]
}

// the amount of liquidity to add that produces
// the given price slippage when swapping amountA
export function addedliquidityFromSlippage(
    amountA: bigint,
    slippageBips: number,
    reserveA: bigint,
    reserveB: bigint
): [bigint, bigint] {
    const adjustedDexFactor = FASSET_MAX_BIPS / DEX_MAX_BIPS * DEX_FACTOR_BIPS
    const slippageFactorBips = FASSET_MAX_BIPS - BigInt(slippageBips)
    const newReserveA = amountA * adjustedDexFactor * slippageFactorBips
        / (adjustedDexFactor - slippageFactorBips) / FASSET_MAX_BIPS
    const addedA = newReserveA - reserveA
    const addedB = addedA * reserveB / reserveA
    return [addedA, addedB]
}

export function swapAndChangeLiquidityToGetReserves(
    oldReserveA: bigint,
    oldReserveB: bigint,
    newReserveA: bigint,
    newReserveB: bigint
): [bigint, bigint, bigint, bigint] {
    const swapInA = swapToDexRatio(oldReserveA, oldReserveB, newReserveA, newReserveB)
    if (swapInA > 0) {
        const swapOutB = swapOutput(swapInA, oldReserveA, oldReserveB)
        const adddedLiquidityA = newReserveA - (oldReserveA + swapInA)
        const addedLiquidityB = newReserveB - (oldReserveB - swapOutB)
        return [swapInA, BigInt(0), adddedLiquidityA, addedLiquidityB]
    }
    const swapInB = swapToDexRatio(oldReserveB, oldReserveA, newReserveB, newReserveA)
    const swapOutA = swapOutput(swapInB, oldReserveB, oldReserveA)
    const adddedLiquidityA = newReserveA - (oldReserveA - swapOutA)
    const addedLiquidityB = newReserveB - (oldReserveB + swapInB)
    return [BigInt(0), swapInB, adddedLiquidityA, addedLiquidityB]
}

////////////////////////////////////////////////////////////////////////////
// asset manager's liquidation calculations

export function liquidationOutput(
    amountFAssetAmg: bigint,
    vaultFactorBips: bigint,
    poolFactorBips: bigint,
    amgVaultPrice: bigint,
    amgPoolPrice: bigint
): [bigint, bigint] {
    const amgWithVaultFactor = amountFAssetAmg * vaultFactorBips / FASSET_MAX_BIPS
    const amountVault = amgToToken(amgWithVaultFactor, amgVaultPrice)
    const amgWithPoolFactor = amountFAssetAmg * poolFactorBips / FASSET_MAX_BIPS
    const amountPool = amgToToken(amgWithPoolFactor, amgPoolPrice)
    return [amountVault, amountPool]
}

export function currentLiquidationFactorBIPS(
    liquidationFactorBips: bigint,
    liquidationFactorVaultBips: bigint,
    vaultCR: bigint,
    poolCR: bigint
): [bigint, bigint] {
    const factorBips = liquidationFactorBips
    let c1FactorBips = (liquidationFactorVaultBips < factorBips)
        ? liquidationFactorVaultBips : factorBips
    if (c1FactorBips > vaultCR) {
        c1FactorBips = vaultCR
    }
    let poolFactorBips = factorBips - c1FactorBips
    if (poolFactorBips > poolCR) {
        poolFactorBips = poolCR;
        const aux = factorBips - poolFactorBips
        c1FactorBips = (aux < vaultCR) ? aux : vaultCR
    }
    return [c1FactorBips, poolFactorBips]
}

export function amgToToken(amgAmount: bigint, amgPrice: bigint): bigint {
    return amgAmount * amgPrice / AMG_TOKEN_WEI_PRICE_SCALE
}

export function amgToTokenPrice(
    assetAmgDecimals: bigint,
    assetFtsoDecimals: bigint,
    assetFtsoPrice: bigint,
    tokenDecimals: bigint,
    tokenFtsoDecimals: bigint,
    tokenFtsoPrice: bigint
): bigint {
    const expPlus = tokenFtsoDecimals + tokenDecimals + AMG_TOKEN_WEI_PRICE_SCALE_EXP
    const expMinus = assetFtsoDecimals + assetAmgDecimals
    const scale = BigInt(10) ** BigInt(expPlus - expMinus)
    return assetFtsoPrice * scale / tokenFtsoPrice
}

export function maxLiquidationAmountAmg(
    collateralRatioBips: bigint,
    factorBips: bigint,
    targetRatioBips: bigint,
    mintedAmg: bigint,
    lotSize: bigint,
    fullLiquidation: boolean
): bigint {
    if (fullLiquidation) {
        return mintedAmg
    }
    if (targetRatioBips <= collateralRatioBips) {
        return BigInt(0)
    }
    if (collateralRatioBips <= factorBips) {
        return mintedAmg
    }
    let maxLiquidatedAMG = mintedAmg * (targetRatioBips - collateralRatioBips) / (targetRatioBips - factorBips)
    maxLiquidatedAMG = roundUpWithPrecision(maxLiquidatedAMG, lotSize)
    return (maxLiquidatedAMG < mintedAmg) ? maxLiquidatedAMG : mintedAmg
}