// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;


struct LiquidityPoolReserves {
    uint256 reserveA;
    uint256 reserveB;
}
struct EcosystemData {
    // addresses
    address assetManager;
    address agentVault;
    // tokens
    address fAssetToken;
    address vaultCT;
    address poolCT;
    // agent vars
    uint256 agentVaultCollateralWei;
    uint256 agentPoolCollateralWei;
    uint256 maxLiquidatedFAssetUBA;
    uint256 liquidationFactorVaultBips;
    uint256 liquidationFactorPoolBips;
    uint256 assetMintingGranularityUBA;
    // dex data
    LiquidityPoolReserves[] reservePathDex1;
    LiquidityPoolReserves[] reservePathDex2;
    address[] swapPathDex1;
    address[] swapPathDex2;
    // ftso prices
    uint256 priceFAssetVaultCTMul;
    uint256 priceFAssetVaultCTDiv;
    uint256 priceFAssetPoolCTMul;
    uint256 priceFAssetPoolCTDiv;
}

struct DexPairConfig {
    address[] path;
    uint256 minPriceMul;
    uint256 minPriceDiv;
}

struct ArbitrageConfig {
    address flashLender;
    address dexRouter;
    DexPairConfig dexPair1;
    DexPairConfig dexPair2;
}