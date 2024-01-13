// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

import "@openzeppelin/contracts/utils/math/Math.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "blazeswap/contracts/periphery/interfaces/IBlazeSwapRouter.sol";
import "fasset/contracts/fasset/interface/IIAssetManager.sol";
import "fasset/contracts/fasset/interface/IIAgentVault.sol";
import "fasset/contracts/fasset/interface/IPriceReader.sol";
import "fasset/contracts/userInterfaces/data/AgentInfo.sol";
import "fasset/contracts/userInterfaces/data/CollateralType.sol";
import "./Structs.sol";
import "./Constants.sol";

import "hardhat/console.sol";

library Ecosystem {

    // ftso symbols
    struct FtsoSymbols {
        string asset;
        string vault;
        string pool;
    }

    // note: this doesn't include the dex reserves
    function getFAssetData(
        address _agentVault
    ) internal view returns (EcosystemData memory _data) {
        // extrapolate data
        IIAssetManager assetManager = IIAgentVault(_agentVault).assetManager();
        AgentInfo.Info memory agentInfo = assetManager.getAgentInfo(address(_agentVault));
        AssetManagerSettings.Data memory settings = assetManager.getSettings();
        // addresses
        _data.assetManager = address(assetManager);
        _data.agentVault = _agentVault;
        // tokens
        _data.fAssetToken = settings.fAsset;
        _data.vaultCT = address(agentInfo.vaultCollateralToken);
        _data.poolCT = address(assetManager.getWNat());
        // agent
        _data.agentVaultCollateralWei = agentInfo.totalVaultCollateralWei;
        _data.agentPoolCollateralWei = agentInfo.totalPoolCollateralNATWei;
        _data.maxLiquidatedFAssetUBA = agentInfo.maxLiquidationAmountUBA;
        _data.liquidationFactorVaultBips = agentInfo.liquidationPaymentFactorVaultBIPS;
        _data.liquidationFactorPoolBips = agentInfo.liquidationPaymentFactorPoolBIPS;
        _data.assetMintingGranularityUBA = settings.assetMintingGranularityUBA;
        // ftso prices
        (
            _data.priceFAssetVaultCTMul,
            _data.priceFAssetVaultCTDiv,
            _data.priceFAssetPoolCTMul,
            _data.priceFAssetPoolCTDiv
        ) = _getPrices(
            IAssetManager(_data.assetManager),
            IPriceReader(settings.priceReader),
            _data.fAssetToken,
            _data.vaultCT,
            _data.poolCT
        );
    }

    function getDexReserves(
        address _dexRouter,
        address[] memory _path
    )
        internal view
        returns (LiquidityPoolReserves[] memory _reserves)
    {
        _reserves = new LiquidityPoolReserves[](_path.length - 1);
        for (uint256 i = 0; i < _path.length - 1; i++) {
            (_reserves[i].reserveA, _reserves[i].reserveB) =
                IBlazeSwapRouter(_dexRouter).getReserves(
                    _path[i], _path[i + 1]
                );
        }
    }

    function _getPrices(
        IAssetManager _assetManager,
        IPriceReader _priceReader,
        address _fAssetToken,
        address _vaultToken,
        address _poolToken
    )
        private view
        returns (
            uint256 priceFAssetVaultCTMul,
            uint256 priceFAssetVaultCTDiv,
            uint256 priceFAssetPoolCTMul,
            uint256 priceFAssetPoolCTDiv
        )
    {
        FtsoSymbols memory symbols = _getFtsoSymbols(_assetManager, IERC20(_vaultToken), IERC20(_poolToken));
        uint8 fAssetDecimals = IERC20Metadata(_fAssetToken).decimals();
        (uint256 fAssetFtsoPrice,, uint256 fAssetFtsoDecimals) = _priceReader.getPrice(symbols.asset);
        {
            // scope to avoid stack too deep error
            (uint256 vaultFtsoPrice,, uint256 vaultFtsoDecimals) = _priceReader.getPrice(symbols.vault);
            (priceFAssetVaultCTMul, priceFAssetVaultCTDiv) = _getTokenAToTokenBPriceMulDiv(
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
            (priceFAssetPoolCTMul, priceFAssetPoolCTDiv) = _getTokenAToTokenBPriceMulDiv(
                fAssetDecimals,
                fAssetFtsoDecimals,
                fAssetFtsoPrice,
                IERC20Metadata(_poolToken).decimals(),
                poolFtsoDecimals,
                poolFtsoPrice
            );
        }
    }

    function _getFtsoSymbols(
        IAssetManager _assetManager,
        IERC20 _vaultToken,
        IERC20 _poolToken
    )
        private view
        returns (FtsoSymbols memory _ftsoSymbols)
    {
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

    function _getTokenAToTokenBPriceMulDiv(
        uint256 _decimalsA,
        uint256 _ftsoDecimalsA,
        uint256 _priceA,
        uint256 _decimalsB,
        uint256 _ftsoDecimalsB,
        uint256 _priceB
    )
        private pure
         returns (uint256, uint256)
    {
        return (
            _priceA * (10 ** (_decimalsB + _ftsoDecimalsB)),
            _priceB * (10 ** (_decimalsA + _ftsoDecimalsA))
        );
    }
}