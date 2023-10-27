// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

import "@openzeppelin/contracts/utils/math/Math.sol";
import "blazeswap/contracts/shared/libraries/Babylonian.sol";
import "./Ecosystem.sol";

// embedded library
library SymbolicOptimum {
    using Babylonian for uint256;

    function getFlashLoanedVaultCollateral(
        Ecosystem.Data memory _data
    ) internal pure returns (uint256) {
        uint256 optVaultAmount = calculateOptimalVaultCollateral(_data);
        uint256 optFAssetAmountUBA = Math.min(
            roundUpWithPrecision(
                getBlazeSwapAmountOut(
                    optVaultAmount,
                    _data.reserveVaultWeiDex1,
                    _data.reserveFAssetUBADex1
                ),  _data.assetMintingGranularityUBA
            ), _data.maxLiquidatedFAssetUBA
        );
        return (optFAssetAmountUBA == 0) ? 0 : Math.min(
            getBlazeSwapAmountIn(
                optFAssetAmountUBA,
                _data.reserveVaultWeiDex1,
                _data.reserveFAssetUBADex1
            ), _data.reserveVaultWeiDex1
        );
    }

    function calculateOptimalVaultCollateral(
        Ecosystem.Data memory _data
    ) internal pure returns (uint256 _amount) {
        // to avoid overflow, we never multiply three non-bips vars
        // (two are ok, as blazeswap allows only 112-bit reserves)
        // unfortunately this can introduce a bit of numerical errors
        {
            // scope to avoid stack too deep error
            _amount
                = _data.reserveVaultWeiDex1
                * 997
                / 1000
                * _data.reservePoolWeiDex2;
            _amount = _amount.sqrt();
        }
        {
            // scope to avoid stack too deep error
            uint256 _aux1
                = _data.reserveFAssetUBADex1
                * _data.liquidationFactorVaultBips
                / 10_000
                * _data.priceFAssetVaultMul
                / _data.priceFAssetVaultDiv
                * _data.reservePoolWeiDex2;
            uint256 _aux2
                = _data.reserveFAssetUBADex1
                * _data.liquidationFactorPoolBips
                / 10_000
                * _data.priceFAssetPoolMul
                / _data.priceFAssetPoolDiv
                * 997
                / 1000
                * _data.reserveVaultWeiDex2;
            _amount *= (_aux1 + _aux2).sqrt();
        }
        {
            // scope to avoid stack too deep error
            uint256 _aux1
                = _data.reserveVaultWeiDex1
                * _data.reservePoolWeiDex2;
            if (_aux1 >= _amount) {
                return 0;
            }
            _amount -= _aux1;
        }
        _amount *= 1000;
        _amount /= 997;
        _amount /= _data.reservePoolWeiDex2;
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