// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

import "@openzeppelin/contracts/utils/math/Math.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "blazeswap/contracts/periphery/interfaces/IBlazeSwapRouter.sol";
import "fasset/contracts/userInterfaces/data/AgentInfo.sol";
import "fasset/contracts/fasset/interface/IPriceReader.sol";
import "blazeswap/contracts/shared/libraries/Babylonian.sol";
import "fasset/contracts/userInterfaces/IAssetManager.sol";

import "hardhat/console.sol";


// embedded library
library ArbitrageStrategy {
    using Babylonian for uint256;

    // for now assume that flash loans do not have fees
    struct ArbitrageData {
        // agent
        uint256 agentVaultCollateralWei;
        uint256 agentPoolCollateralWei;
        uint256 maxLiquidatedFAssetUBA;
        uint256 liquidationFactorVaultBips;
        uint256 liquidationFactorPoolBips;
        // dexes
        uint256 feeBipsDex1;
        uint256 feeBipsDex2;
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

    function getOptimalVaultCollateral(
        address _poolToken,
        AgentInfo.Info memory _agentInfo,
        AssetManagerSettings.Data memory _assetManagerSettings,
        IBlazeSwapRouter _blazeSwap
    ) internal view returns (uint256) {
        ArbitrageData memory arbitrageData = _getArbitrageData(
            _poolToken,
            _agentInfo,
            _assetManagerSettings,
            _blazeSwap
        );
        return _calculateOptimalVaultCollateral(arbitrageData);
    }

    function _calculateOptimalVaultCollateral(
        ArbitrageData memory _arbitrageData
    ) internal pure returns (uint256 _amount) {
        uint256 factorBipsDex1 = 10_000 - _arbitrageData.feeBipsDex1;
        uint256 factorBipsDex2 = 10_000 - _arbitrageData.feeBipsDex2;
        {
            // scope to avoid stack too deep errors
            uint256 _aux1 = _arbitrageData.reserveFAssetUBADex1
                * _arbitrageData.priceFAssetVaultMul
                * _arbitrageData.liquidationFactorVaultBips
                * _arbitrageData.reserveVaultWeiDex1
                * _arbitrageData.reservePoolWeiDex2 ** 2 // TODO: handle overflows
                // * _arbitrageData.flashLoanFeeBips
                * factorBipsDex1 ** 3 // TODO: handle overflows
                / _arbitrageData.priceFAssetVaultDiv
                / 10_000 ** 3;
            uint256 _aux2 = _arbitrageData.reserveFAssetUBADex1
                * _arbitrageData.priceFAssetPoolMul
                * _arbitrageData.liquidationFactorPoolBips
                * _arbitrageData.reserveVaultWeiDex1
                * _arbitrageData.reserveVaultWeiDex2
                * _arbitrageData.reservePoolWeiDex2
                // * _arbitrageData.flashLoanFeeBips
                * factorBipsDex1 ** 3 // TODO: handle overflows
                * factorBipsDex2
                / _arbitrageData.priceFAssetPoolDiv
                / 10_000 ** 3;
            _amount += (_aux1 + _aux2).sqrt();
        }
        {
            // scope to avoid stack too deep errors
            uint256 _aux3 = _arbitrageData.reserveVaultWeiDex1
                * _arbitrageData.reservePoolWeiDex2
                // * _arbitrageData.flashLoanFeeBips
                * factorBipsDex1
                / 10_000;
            require(_aux3 < _amount, "Arbitrage failed: negative vault amount");
            _amount -= _aux3;
        }
        {
            // scope to avoid stack too deep errors
            uint256 _aux4 = _arbitrageData.reservePoolWeiDex2
                // * _arbitrageData.flashLoanFeeBips
                * factorBipsDex1 ** 2 // TODO: handle overflows
                / 10_000 ** 2;
            require(_aux4 > 0, "Arbitrage failed: pool reserve of pool wei is zero");
            _amount /= _aux4;
        }
    }

    function _getArbitrageData(
        address _poolToken,
        AgentInfo.Info memory _agentInfo,
        AssetManagerSettings.Data memory _assetManagerSettings,
        IBlazeSwapRouter _blazeSwap
        /* IFlashLender _flashLender */
    ) internal view returns (ArbitrageData memory _arbitrageData) {
        // tokens
        address vaultToken = address(_agentInfo.vaultCollateralToken);
        address fAssetToken = _assetManagerSettings.fAsset;
        // agent
        _arbitrageData.agentVaultCollateralWei = _agentInfo.totalVaultCollateralWei;
        _arbitrageData.agentPoolCollateralWei = _agentInfo.totalPoolCollateralNATWei;
        // asset manager liquidation (fix this when liquidation data is included in AgentInfo)
        _arbitrageData.maxLiquidatedFAssetUBA = _agentInfo.maxLiquidationAmountUBA;
        _arbitrageData.liquidationFactorVaultBips = _agentInfo.liquidationPaymentFactorVaultBIPS;
        _arbitrageData.liquidationFactorPoolBips = _agentInfo.liquidationPaymentFactorPoolBIPS;
        // dexes
        _arbitrageData.feeBipsDex1 = 3000; // blazeswap hardcodes 0.3% fee like uniswap-v2
        _arbitrageData.feeBipsDex2 = 3000; // blazeswap hardcodes 0.3% fee like uniswap-v2
        (_arbitrageData.reserveVaultWeiDex1, _arbitrageData.reserveFAssetUBADex1) = _blazeSwap.getReserves(
            vaultToken, fAssetToken
        );
        (_arbitrageData.reservePoolWeiDex2, _arbitrageData.reserveVaultWeiDex2) = _blazeSwap.getReserves(
            _poolToken, vaultToken
        );
        // prices
        string memory fAssetSymbol = IERC20Metadata(fAssetToken).symbol();
        uint8 fAssetDecimals = IERC20Metadata(fAssetToken).decimals();
        (_arbitrageData.priceFAssetVaultMul, _arbitrageData.priceFAssetVaultDiv) = _getToken1Token2PriceMulDiv(
            IPriceReader(_assetManagerSettings.priceReader),
            fAssetSymbol, fAssetDecimals,
            IERC20Metadata(vaultToken).symbol(),
            IERC20Metadata(vaultToken).decimals()
        );
        (_arbitrageData.priceFAssetPoolMul, _arbitrageData.priceFAssetPoolDiv) = _getToken1Token2PriceMulDiv(
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