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
// blaze swap

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