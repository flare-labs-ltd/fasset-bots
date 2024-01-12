// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

// constants for dex fees and bips settings
uint256 constant MAX_BIPS = 10000;
uint256 constant DEX_MAX_BIPS = 1000;
uint256 constant DEX_FEE_BIPS = 3;
uint256 constant DEX_FACTOR_BIPS = DEX_MAX_BIPS - DEX_FEE_BIPS;

// default values
uint256 constant MAX_SLIPPAGE_BIPS = 100;

// for now assume that flash loans do
// not have fees or that they are fixed
struct EcosystemData {
    // addresses
    address assetManager;
    address agentVault;
    // tokens
    address fAssetToken;
    address vaultToken;
    address poolToken;
    // agent vars
    uint256 agentVaultCollateralWei;
    uint256 agentPoolCollateralWei;
    uint256 maxLiquidatedFAssetUBA;
    uint256 liquidationFactorVaultBips;
    uint256 liquidationFactorPoolBips;
    uint256 assetMintingGranularityUBA;
    // dex vars
    uint256 reserveVaultWeiDex1;
    uint256 reserveFAssetUBADex1;
    uint256 reservePoolWeiDex2;
    uint256 reserveVaultWeiDex2;
    uint256 dex1PathLength;
    uint256 dex2PathLength;
    // price vars
    uint256 priceFAssetVaultMul;
    uint256 priceFAssetVaultDiv;
    uint256 priceFAssetPoolMul;
    uint256 priceFAssetPoolDiv;
}

struct DexPairConfig {
    address[] path;
    uint256 minPriceMul;
    uint256 minPriceDiv;
}

struct ArbitrageConfig {
    address flashLender;
    address dex;
    DexPairConfig dex1;
    DexPairConfig dex2;
}