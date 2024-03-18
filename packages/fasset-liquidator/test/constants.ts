// evm constants
export const MAX_UINT_256 = BigInt(2) ** BigInt(256) - BigInt(1)

// f-asset constants
export const AMG_TOKEN_WEI_PRICE_SCALE_EXP = BigInt(9)
export const AMG_TOKEN_WEI_PRICE_SCALE = BigInt(10) ** AMG_TOKEN_WEI_PRICE_SCALE_EXP
export const FASSET_MAX_BIPS = BigInt(10_000)

// uniswap-v2 constants
export const DEX_FEE_BIPS = BigInt(3)
export const DEX_MAX_BIPS = BigInt(1000)
export const DEX_FACTOR_BIPS = DEX_MAX_BIPS - DEX_FEE_BIPS

// tests
export const PRICE_PRECISION = BigInt(1e18)
export const GRAPH_POINTS = 200 // visualising liquidation optimability