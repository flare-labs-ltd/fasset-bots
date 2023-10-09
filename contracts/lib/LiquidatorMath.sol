// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

import "@openzeppelin/contracts/utils/math/Math.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "blazeswap/contracts/periphery/interfaces/IBlazeSwapRouter.sol";
import "blazeswap/contracts/shared/libraries/Babylonian.sol";
import "fasset/contracts/userInterfaces/data/AgentInfo.sol";
import "fasset/contracts/fasset/interface/IPriceReader.sol";
import "fasset/contracts/userInterfaces/IAssetManager.sol";
import "fasset/contracts/userInterfaces/data/CollateralType.sol";


// embedded library
library LiquidatorMath {
    using Babylonian for uint256;

    struct FtsoSymbols {
        string asset;
        string vault;
        string pool;
    }

    // for now assume that flash loans do
    // not have fees or that they are fixed
    struct LiquidatorVars {
        // agent
        uint256 agentVaultCollateralWei;
        uint256 agentPoolCollateralWei;
        uint256 maxLiquidatedFAssetUBA;
        uint256 liquidationFactorVaultBips;
        uint256 liquidationFactorPoolBips;
        // dexes
        uint256 reserveVaultWeiDex1;
        uint256 reserveFAssetUBADex1;
        uint256 reservePoolWeiDex2;
        uint256 reserveVaultWeiDex2;
        // prices
        uint256 priceFAssetVaultMul;
        uint256 priceFAssetVaultDiv;
        uint256 priceFAssetPoolMul;
        uint256 priceFAssetPoolDiv;
    }

    function getFlashLoanedVaultCollateral(
        address _poolToken,
        IAssetManager _assetManager,
        IBlazeSwapRouter _blazeSwap,
        AgentInfo.Info memory _agentInfo,
        AssetManagerSettings.Data memory _assetManagerSettings
    ) internal view returns (uint256) {
        LiquidatorVars memory liquidatorVars = getLiquidatorVars(
            _poolToken,
            _assetManager,
            _blazeSwap,
            _agentInfo,
            _assetManagerSettings
        );
        uint256 optVaultAmount = calculateOptimalVaultCollateral(liquidatorVars);
        uint256 optFAssetAmountUBA = Math.min(
            roundUpWithPrecision(
                getBlazeSwapAmountOut(
                    optVaultAmount,
                    liquidatorVars.reserveVaultWeiDex1,
                    liquidatorVars.reserveFAssetUBADex1
                ),  _assetManagerSettings.assetMintingGranularityUBA
            ), liquidatorVars.maxLiquidatedFAssetUBA
        );
        if (optFAssetAmountUBA == 0) {
            return 0;
        }
        return Math.min(
            getBlazeSwapAmountIn(
                optFAssetAmountUBA,
                liquidatorVars.reserveVaultWeiDex1,
                liquidatorVars.reserveFAssetUBADex1
            ), liquidatorVars.reserveVaultWeiDex1
        );
    }

    function calculateOptimalVaultCollateral(
        LiquidatorVars memory _liquidatorVars
    ) internal pure returns (uint256 _amount) {
        // to avoid overflow, we never multiply three non-bips vars
        // (two are ok, as blazeswap allows only 112-bit reserves)
        // unfortunately this can introduce a bit of numerical errors
        {
            // scope to avoid stack too deep error
            _amount
                = _liquidatorVars.reserveVaultWeiDex1
                * 997
                / 1000
                * _liquidatorVars.reservePoolWeiDex2;
            _amount = _amount.sqrt();
        }
        {
            // scope to avoid stack too deep error
            uint256 _aux1
                = _liquidatorVars.reserveFAssetUBADex1
                * _liquidatorVars.liquidationFactorVaultBips
                / 10_000
                * _liquidatorVars.priceFAssetVaultMul
                / _liquidatorVars.priceFAssetVaultDiv
                * _liquidatorVars.reservePoolWeiDex2;
            uint256 _aux2
                = _liquidatorVars.reserveFAssetUBADex1
                * _liquidatorVars.liquidationFactorPoolBips
                / 10_000
                * _liquidatorVars.priceFAssetPoolMul
                / _liquidatorVars.priceFAssetPoolDiv
                * 997
                / 1000
                * _liquidatorVars.reserveVaultWeiDex2;
            _amount *= (_aux1 + _aux2).sqrt();
        }
        {
            // scope to avoid stack too deep error
            uint256 _aux1
                = _liquidatorVars.reserveVaultWeiDex1
                * _liquidatorVars.reservePoolWeiDex2;
            if (_aux1 >= _amount) {
                return 0;
            }
            _amount -= _aux1;
        }
        _amount *= 1000;
        _amount /= 997;
        _amount /= _liquidatorVars.reservePoolWeiDex2;
    }

    function getLiquidatorVars(
        address _poolToken,
        IAssetManager _assetManager,
        IBlazeSwapRouter _blazeSwap,
        AgentInfo.Info memory _agentInfo,
        AssetManagerSettings.Data memory _assetManagerSettings
    ) internal view returns (LiquidatorVars memory _liquidatorVars) {
        // tokens
        address vaultToken = address(_agentInfo.vaultCollateralToken);
        address fAssetToken = _assetManagerSettings.fAsset;
        // agent
        _liquidatorVars.agentVaultCollateralWei = _agentInfo.totalVaultCollateralWei;
        _liquidatorVars.agentPoolCollateralWei = _agentInfo.totalPoolCollateralNATWei;
        _liquidatorVars.maxLiquidatedFAssetUBA = _agentInfo.maxLiquidationAmountUBA;
        _liquidatorVars.liquidationFactorVaultBips = _agentInfo.liquidationPaymentFactorVaultBIPS;
        _liquidatorVars.liquidationFactorPoolBips = _agentInfo.liquidationPaymentFactorPoolBIPS;
        // dexes
        (_liquidatorVars.reserveVaultWeiDex1, _liquidatorVars.reserveFAssetUBADex1) = _blazeSwap.getReserves(
            vaultToken, fAssetToken
        );
        (_liquidatorVars.reservePoolWeiDex2, _liquidatorVars.reserveVaultWeiDex2) = _blazeSwap.getReserves(
            _poolToken, vaultToken
        );
        // prices
        (
            _liquidatorVars.priceFAssetVaultMul,
            _liquidatorVars.priceFAssetVaultDiv,
            _liquidatorVars.priceFAssetPoolMul,
            _liquidatorVars.priceFAssetPoolDiv
        ) = getPrices(
            _assetManager,
            IPriceReader(_assetManagerSettings.priceReader),
            fAssetToken,
            vaultToken,
            _poolToken
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

    // given an output amount of an asset and pair reserves,
    // returns a required input amount of the other asset
    function getBlazeSwapAmountIn(
        uint256 amountOut,
        uint256 reserveIn,
        uint256 reserveOut
    ) internal pure returns (uint256 amountIn) {
        uint256 numerator = reserveIn * amountOut * 1000;
        uint256 denominator = (reserveOut - amountOut) * 997;
        amountIn = numerator / denominator + 1;
    }

    // given an input amount of an asset and pair reserves,
    // returns the maximum output amount of the other asset
    function getBlazeSwapAmountOut(
        uint256 amountIn,
        uint256 reserveIn,
        uint256 reserveOut
    ) internal pure returns (uint256 amountOut) {
        uint256 amountInWithFee = amountIn * 997;
        uint256 numerator = amountInWithFee * reserveOut;
        uint256 denominator = reserveIn * 1000 + amountInWithFee;
        amountOut = numerator / denominator;
    }

    function roundUpWithPrecision(
        uint256 _amount,
        uint256 _precision
    ) private pure returns (uint256) {
        uint256 _aux = _amount % _precision;
        return (_aux == 0) ? _amount : _amount + _precision - _aux;
    }

}