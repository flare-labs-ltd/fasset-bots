// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;


struct PoolReserves {
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
    uint256 maxLiquidatedFAssetUBA;
    uint256 liquidationFactorVaultBips;
    uint256 liquidationFactorPoolBips;
    // asset manager vars
    uint256 assetMintingGranularityUBA;
    uint256 assetMintingDecimals;
    // ftso prices
    uint256 priceFAssetAmgVaultCT;
    uint256 priceFAssetAmgPoolCT;
    // dex data
    PoolReserves[] reservePathDex1;
    PoolReserves[] reservePathDex2;
    address[] swapPathDex1;
    address[] swapPathDex2;
}

struct DexPairConfig {
    address[] path;
    uint256 minPriceMul;
    uint256 minPriceDiv;
}

struct ArbitrageConfig {
    address flashLender;
    uint256 maxFlashFeeBips;
    address dex;
    DexPairConfig dexPair1;
    DexPairConfig dexPair2;
}
