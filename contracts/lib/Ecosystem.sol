// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "blazeswap/contracts/periphery/interfaces/IBlazeSwapRouter.sol";
import "fasset/contracts/fasset/interface/IIAssetManager.sol";
import "fasset/contracts/fasset/interface/IIAgentVault.sol";
import "fasset/contracts/fasset/interface/IPriceReader.sol";
import "fasset/contracts/userInterfaces/data/AgentInfo.sol";
import "fasset/contracts/userInterfaces/data/CollateralType.sol";

// embedded library
library Ecosystem {

    struct FtsoSymbols {
        string asset;
        string vault;
        string pool;
    }

    // for now assume that flash loans do
    // not have fees or that they are fixed
    struct Data {
        // addresses
        address assetManager;
        address agentVault;
        address blazeSwap;
        address flashLender;
        // tokens
        address fAsset;
        address vault;
        address pool;
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
        // price vars
        uint256 priceFAssetVaultMul;
        uint256 priceFAssetVaultDiv;
        uint256 priceFAssetPoolMul;
        uint256 priceFAssetPoolDiv;
    }

    function getData(
        address _agentVault,
        address _blazeSwap,
        address _flashLender
    ) internal view returns (Data memory _data) {
        // extrapolate data
        IIAssetManager assetManager = IIAgentVault(_agentVault).assetManager();
        AgentInfo.Info memory agentInfo = assetManager.getAgentInfo(address(_agentVault));
        require(agentInfo.maxLiquidationAmountUBA > 0, "Liquidator: Agent not in liquidation");
        AssetManagerSettings.Data memory settings = assetManager.getSettings();
        // addresses
        _data.assetManager = address(assetManager);
        _data.agentVault = _agentVault;
        _data.blazeSwap = _blazeSwap;
        _data.flashLender = _flashLender;
        // tokens
        _data.fAsset = settings.fAsset;
        _data.vault = address(agentInfo.vaultCollateralToken);
        _data.pool = address(assetManager.getWNat());
        // agent
        _data.agentVaultCollateralWei = agentInfo.totalVaultCollateralWei;
        _data.agentPoolCollateralWei = agentInfo.totalPoolCollateralNATWei;
        _data.maxLiquidatedFAssetUBA = agentInfo.maxLiquidationAmountUBA;
        _data.liquidationFactorVaultBips = agentInfo.liquidationPaymentFactorVaultBIPS;
        _data.liquidationFactorPoolBips = agentInfo.liquidationPaymentFactorPoolBIPS;
        _data.assetMintingGranularityUBA = settings.assetMintingGranularityUBA;
        // dexes
        (_data.reserveVaultWeiDex1, _data.reserveFAssetUBADex1) =
            IBlazeSwapRouter(_blazeSwap).getReserves(_data.vault, _data.fAsset);
        (_data.reservePoolWeiDex2, _data.reserveVaultWeiDex2) =
            IBlazeSwapRouter(_blazeSwap).getReserves(_data.pool, _data.vault);
        // prices
        (
            _data.priceFAssetVaultMul,
            _data.priceFAssetVaultDiv,
            _data.priceFAssetPoolMul,
            _data.priceFAssetPoolDiv
        ) = getPrices(
            IAssetManager(_data.assetManager),
            IPriceReader(settings.priceReader),
            _data.fAsset,
            _data.vault,
            _data.pool
        );
    }

    function getPrices(
        IAssetManager _assetManager,
        IPriceReader _priceReader,
        address _fAssetToken,
        address _vaultToken,
        address _poolToken
    )
        internal view
        returns (
            uint256 priceFAssetVaultMul,
            uint256 priceFAssetVaultDiv,
            uint256 priceFAssetPoolMul,
            uint256 priceFAssetPoolDiv
        )
    {
        FtsoSymbols memory symbols = getFtsoSymbols(_assetManager, IERC20(_vaultToken), IERC20(_poolToken));
        uint8 fAssetDecimals = IERC20Metadata(_fAssetToken).decimals();
        (uint256 fAssetFtsoPrice,, uint256 fAssetFtsoDecimals) = _priceReader.getPrice(symbols.asset);
        {
            // scope to avoid stack too deep error
            (uint256 vaultFtsoPrice,, uint256 vaultFtsoDecimals) = _priceReader.getPrice(symbols.vault);
            (priceFAssetVaultMul, priceFAssetVaultDiv) = getTokenAToTokenBPriceMulDiv(
                fAssetDecimals,
                fAssetFtsoDecimals,
                fAssetFtsoPrice,
                IERC20Metadata(_vaultToken).decimals(),
                vaultFtsoDecimals,
                vaultFtsoPrice
            );
        }
        {
            // scope to avoid stack too deep error
            (uint256 poolFtsoPrice,, uint256 poolFtsoDecimals) = _priceReader.getPrice(symbols.pool);
            (priceFAssetPoolMul, priceFAssetPoolDiv) = getTokenAToTokenBPriceMulDiv(
                fAssetDecimals,
                fAssetFtsoDecimals,
                fAssetFtsoPrice,
                IERC20Metadata(_poolToken).decimals(),
                poolFtsoDecimals,
                poolFtsoPrice
            );
        }
    }

    function getFtsoSymbols(
        IAssetManager _assetManager,
        IERC20 _vaultToken,
        IERC20 _poolToken
    ) internal view returns (FtsoSymbols memory _ftsoSymbols) {
        CollateralType.Data memory vaultData = _assetManager.getCollateralType(
            CollateralType.Class.VAULT, _vaultToken
        );
        CollateralType.Data memory poolData = _assetManager.getCollateralType(
            CollateralType.Class.POOL, _poolToken
        );
        _ftsoSymbols.asset = vaultData.assetFtsoSymbol;
        _ftsoSymbols.vault = vaultData.tokenFtsoSymbol;
        _ftsoSymbols.pool = poolData.tokenFtsoSymbol;
    }

    function getTokenAToTokenBPriceMulDiv(
        uint256 _decimalsA,
        uint256 _ftsoDecimalsA,
        uint256 _priceA,
        uint256 _decimalsB,
        uint256 _ftsoDecimalsB,
        uint256 _priceB
    ) internal pure returns (uint256, uint256) {
        return (
            _priceA * (10 ** (_decimalsB + _ftsoDecimalsB)),
            _priceB * (10 ** (_decimalsA + _ftsoDecimalsA))
        );
    }
}