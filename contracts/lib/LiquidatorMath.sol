// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

import "@openzeppelin/contracts/utils/math/Math.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "blazeswap/contracts/periphery/interfaces/IBlazeSwapRouter.sol";
import "fasset/contracts/userInterfaces/data/AgentInfo.sol";
import "fasset/contracts/fasset/interface/IPriceReader.sol";
import "blazeswap/contracts/shared/libraries/Babylonian.sol";
import "fasset/contracts/userInterfaces/IAssetManager.sol";


// embedded library
library LiquidatorMath {
    using Babylonian for uint256;

    // for now assume that flash loans do not have fees
    struct LiquidatorVars {
        // agent
        uint256 agentVaultCollateralWei;
        uint256 agentPoolCollateralWei;
        uint256 maxLiquidatedFAssetUBA;
        uint256 liquidationFactorVaultBips;
        uint256 liquidationFactorPoolBips;
        // dexes
        uint256 feeFactorBipsDex1; // 1 - dex fee
        uint256 feeFactorBipsDex2; // 1 - dex fee
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

    function getUsedVaultCollateral(
        address _poolToken,
        AgentInfo.Info memory _agentInfo,
        AssetManagerSettings.Data memory _assetManagerSettings,
        IBlazeSwapRouter _blazeSwap
    ) internal view returns (uint256) {
        LiquidatorVars memory liquidatorVars = _getLiquidatorVars(
            _poolToken,
            _agentInfo,
            _assetManagerSettings,
            _blazeSwap
        );
        uint256 optAmount = _calculateOptimalVaultCollateral(liquidatorVars);
        uint256 maxAmount = _calculateMaximumVaultCollateral(liquidatorVars);
        return Math.min(optAmount, maxAmount);
    }

    function _calculateOptimalVaultCollateral(
        LiquidatorVars memory _liquidatorVars
    ) internal pure returns (uint256 _amount) {
        // to avoid overflow, we never multiply three non-bips vars
        // unfortunately this can introduce a bit of numerical errors
        {
            // scope to avoid stack too deep error
            _amount
                = _liquidatorVars.reserveVaultWeiDex1
                * _liquidatorVars.feeFactorBipsDex1
                / 10_000
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
                * _liquidatorVars.feeFactorBipsDex2
                / 10_000
                * _liquidatorVars.reserveVaultWeiDex2;
            _amount *= (_aux1 + _aux2).sqrt();
        }
        {
            // scope to avoid stack too deep error
            uint256 _aux1
                = _liquidatorVars.reserveVaultWeiDex1
                * _liquidatorVars.reservePoolWeiDex2;
            require(_aux1 < _amount, "Arbitrage failed due to numeric error");
            _amount -= _aux1;
        }
        _amount *= 10_000;
        _amount /= _liquidatorVars.feeFactorBipsDex1;
        _amount /= _liquidatorVars.reservePoolWeiDex2;
    }

    // gets the vault collateral that when swapped produces maxLiquidatedFAssetUBA
    // numeric errors should cause this value to only ever be lower!
    function _calculateMaximumVaultCollateral(
        LiquidatorVars memory _liquidatorVars
    ) internal pure returns (uint256) {
        require(_liquidatorVars.reserveFAssetUBADex1 > _liquidatorVars.maxLiquidatedFAssetUBA,
            "Arbitrage failed: max liquidated f-asset is greater than f-asset reserve");
        uint256 _aux1 = _liquidatorVars.maxLiquidatedFAssetUBA
            * _liquidatorVars.reserveVaultWeiDex1;
        uint256 _aux2 = _liquidatorVars.reserveFAssetUBADex1
            - _liquidatorVars.maxLiquidatedFAssetUBA;
        return _aux1 * 10_000 / _aux2 / _liquidatorVars.feeFactorBipsDex1;
    }

    function _getLiquidatorVars(
        address _poolToken,
        AgentInfo.Info memory _agentInfo,
        AssetManagerSettings.Data memory _assetManagerSettings,
        IBlazeSwapRouter _blazeSwap
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
        _liquidatorVars.feeFactorBipsDex1 = 9970; // blazeswap hardcodes 0.3% fee like uniswap-v2
        _liquidatorVars.feeFactorBipsDex2 = 9970; // blazeswap hardcodes 0.3% fee like uniswap-v2
        (_liquidatorVars.reserveVaultWeiDex1, _liquidatorVars.reserveFAssetUBADex1) = _blazeSwap.getReserves(
            vaultToken, fAssetToken
        );
        (_liquidatorVars.reservePoolWeiDex2, _liquidatorVars.reserveVaultWeiDex2) = _blazeSwap.getReserves(
            _poolToken, vaultToken
        );
        // prices
        string memory fAssetSymbol = IERC20Metadata(fAssetToken).symbol();
        uint8 fAssetDecimals = IERC20Metadata(fAssetToken).decimals();
        (
            _liquidatorVars.priceFAssetVaultMul,
            _liquidatorVars.priceFAssetVaultDiv
        ) = _getToken1Token2PriceMulDiv(
            IPriceReader(_assetManagerSettings.priceReader),
            fAssetSymbol, fAssetDecimals,
            IERC20Metadata(vaultToken).symbol(),
            IERC20Metadata(vaultToken).decimals()
        );
        (
            _liquidatorVars.priceFAssetPoolMul,
            _liquidatorVars.priceFAssetPoolDiv
        ) = _getToken1Token2PriceMulDiv(
            IPriceReader(_assetManagerSettings.priceReader),
            fAssetSymbol, fAssetDecimals,
            IERC20Metadata(_poolToken).symbol(),
            IERC20Metadata(_poolToken).decimals()
        );
    }

    function _getToken1Token2PriceMulDiv(
        IPriceReader _priceReader,
        string memory _symbol1,
        uint256 _decimals1,
        string memory _symbol2,
        uint256 _decimals2
    ) internal view returns (uint256, uint256) {
        (uint256 price1,, uint256 ftsoDecimals1) = _priceReader.getPrice(_symbol1);
        (uint256 price2,, uint256 ftsoDecimals2) = _priceReader.getPrice(_symbol2);
        return (
            price1 * (10 ** (_decimals2 + ftsoDecimals2)),
            price2 * (10 ** (_decimals1 + ftsoDecimals1))
        );
    }

}