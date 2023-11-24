////////////////////////////////////////////////////////////////////////////
// conversions

export function convertUsd5ToTokens(
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

////////////////////////////////////////////////////////////////////////////
// implicit ecosystem setters

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
  const ratioA = priceB * BigInt(10) ** decimalsA
  const ratioB = priceA * BigInt(10) ** decimalsB
  const factorA = BigInt(10_000) * (maxAddedA + initialReserveA) / ratioA
  const factorB = BigInt(10_000) * (maxAddedB + initialReserveB) / ratioB
  const factor = (factorA < factorB) ? factorA : factorB
  const addedA = factor * ratioA / BigInt(10_000) - initialReserveA
  const addedB = factor * ratioB / BigInt(10_000) - initialReserveB
  return [addedA, addedB]
}

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
  reserveA: bigint,
  reserveB: bigint,
  amountA: bigint
): bigint {
  const amountAWithFee = BigInt(997) * amountA
  const numerator = amountAWithFee * reserveB
  const denominator = BigInt(1000) * reserveA + amountAWithFee
  return numerator / denominator
}

// calculates the amount of tokenB needed
// to swap to obtain amountA of tokenIn
export function swapInput(
  reserveA: bigint,
  reserveB: bigint,
  amountB: bigint
): bigint {
  const numerator = BigInt(1000) * reserveA * amountB
  const denominator = BigInt(997) * (reserveB - amountB)
  return numerator / denominator + BigInt(1)
}