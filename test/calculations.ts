import { AMG_TOKEN_WEI_PRICE_SCALE, AMG_TOKEN_WEI_PRICE_SCALE_EXP } from "./constants"

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
    / BigInt(10_000)
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
  // price of f-asset UBA in collateral Wei
  // v / (P(Fu, Vw) f) = R
  // P(Fu, Vw) = v / (f R)
  // new ftso price for the asset
  // P(Fu, Vw) = 10^((dV + fV) - (dF + fF)) P(F, SF) / P(V, SV)
  // P(F, SF) = 10^((dF + fF) - (dV + fV)) P(V, SV) P(Fu, Vw)
  // put together
  // P(F, SF) = 10^((dF + fF) - (dV + fV)) P(V, SV) v / (f R)
  const expPlus = fAssetTokenDecimals + fAssetFtsoDecimals
  const expMinus = collateralTokenDecimals + collateralFtsoDecimals
  return BigInt(10) ** expPlus
    * collateralFtsoPrice
    * collateralWei
    * BigInt(10_000)
    / BigInt(10) ** expMinus
    / crBips
    / totalMintedUBA
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
  const amountAWithFee = BigInt(997) * amountA
  const numerator = amountAWithFee * reserveB
  const denominator = BigInt(1000) * reserveA + amountAWithFee
  return numerator / denominator
}

// calculates the amount of tokenB needed
// to swap to obtain amountA of tokenIn
export function swapInput(
  amountB: bigint,
  reserveA: bigint,
  reserveB: bigint
): bigint {
  const numerator = BigInt(1000) * reserveA * amountB
  const denominator = BigInt(997) * (reserveB - amountB)
  return numerator / denominator + BigInt(1)
}

// for consecutive swaps that affect the following ones
// so we have to track and adjust the reserves
export function swapOutputs(
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
      const [resA, resB] = reserve[j-1]
      const aux = swapOutput(amountsOut[i], resA, resB)
      for (let k = i + 1; k < paths.length; k++) {
        // liquidity pool paths[k][j-1] / paths[k][j]
        const pathToModify = paths[k]
        for (let l = 1; l < pathToModify.length; l++) {
          if (pathToModify[l-1] == path[j-1] && pathToModify[l] == path[j]) {
            reserves[k][l-1][0] += amountsOut[i]
            reserves[k][l-1][1] -= aux
          } else if (pathToModify[l-1] == path[j] && pathToModify[l] == path[j-1]) {
            reserves[k][l-1][0] -= aux
            reserves[k][l-1][1] += amountsOut[i]
          }
        }
      }
      amountsOut[i] = aux
    }
  }
  return amountsOut
}

export function swapInputs(
  amountOut: bigint,
  reserves: [bigint, bigint][]
): bigint {
  let amountIn = amountOut
  for (let i = reserves.length; i > 0; i--) {
    const [reserveA, reserveB] = reserves[i-1]
    amountIn = swapInput(amountIn, reserveA, reserveB)
  }
  return amountIn
}

// procrastinate P(A,B) can drop for maxSlippageBips
export function dexMinPriceFromMaxSlippage(
  maxSlippageBips: number,
  reserveA: bigint,
  reserveB: bigint
): [bigint, bigint] {
  return [reserveB * BigInt(10_000 - maxSlippageBips), reserveA]
}

////////////////////////////////////////////////////////////////////////////
// ecosystem setters used to align dex prices with ftso

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
  const factorA = BigInt(10_000) * (maxAddedA + initialReserveA) / ratioA
  const factorB = BigInt(10_000) * (maxAddedB + initialReserveB) / ratioB
  const factor = (factorA < factorB) ? factorA : factorB
  const addedA = factor * ratioA / BigInt(10_000) - initialReserveA
  const addedB = factor * ratioB / BigInt(10_000) - initialReserveB
  return [addedA, addedB]
}

function sqrt(value: bigint): bigint {
  if (value < BigInt(0)) throw Error()
  if (value < BigInt(2)) return value
  function newtonIteration(n: bigint, x0: bigint): bigint {
      const x1 = ((n / x0) + x0) >> BigInt(1)
      if (x0 === x1 || x0 === (x1 - BigInt(1)))
          return x0
      return newtonIteration(n, x1)
  }
  return newtonIteration(value, BigInt(1))
}

export function swapToDexPrice(
  initialReserveA: bigint,
  initialReserveB: bigint,
  priceA: bigint,
  priceB: bigint,
  decimalsA: bigint,
  decimalsB: bigint,
  maxAmountA: bigint
): bigint {
  const [ratioA, ratioB] = priceAB(priceA, priceB, decimalsA, decimalsB)
  const aux = initialReserveB * initialReserveA * ratioB / ratioA
  const amountA = sqrt(aux) - initialReserveA
  return (amountA < maxAmountA) ? amountA : maxAmountA
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
  const amgWithVaultFactor = amountFAssetAmg * vaultFactorBips / BigInt(10_000)
  const amountVault = amgToToken(amgWithVaultFactor, amgVaultPrice)
  const amgWithPoolFactor = amountFAssetAmg * poolFactorBips / BigInt(10_000)
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