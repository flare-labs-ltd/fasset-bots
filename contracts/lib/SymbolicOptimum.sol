// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

import "@openzeppelin/contracts/utils/math/Math.sol";
import "blazeswap/contracts/shared/libraries/Babylonian.sol";
import "./Constants.sol";


// embedded library
library SymbolicOptimum {
    using Babylonian for uint256;

    function getFlashLoanedVaultCollateral(
        EcosystemData memory _data

    ) internal pure returns (uint256) {
        uint256 optVaultCollateral = calculateOptimalVaultCollateral(_data);
        return getDexSwapAmountInForAmgMultiplier(_data, optVaultCollateral);
    }

    function calculateOptimalVaultCollateral(
        EcosystemData memory _data
    ) internal pure returns (uint256 _amount) {
        // set fee factors (1 - fee) for each dex
        // depends on length of the path to swap through!
        uint256 feeFactorBipsDex1
            = DEX_FACTOR_BIPS ** (_data.dex1PathLength - 1)
            / DEX_MAX_BIPS ** (_data.dex1PathLength - 2);
        uint256 feeFactorBipsDex2
            = DEX_FACTOR_BIPS ** (_data.dex2PathLength - 1)
            / DEX_MAX_BIPS ** (_data.dex2PathLength - 2);
        // to avoid overflow, we never multiply three non-bips vars
        // (two are ok, as blazeswap allows only 112-bit reserves)
        {
            // scope to avoid stack too deep error
            _amount
                = _data.reserveVaultWeiDex1
                * feeFactorBipsDex1
                / DEX_MAX_BIPS
                * _data.reservePoolWeiDex2;
            _amount = _amount.sqrt();
        }
        {
            // scope to avoid stack too deep error
            uint256 _aux1
                = _data.reserveFAssetUBADex1
                * _data.liquidationFactorVaultBips
                / MAX_BIPS
                * _data.priceFAssetVaultMul
                / _data.priceFAssetVaultDiv
                * _data.reservePoolWeiDex2;
            uint256 _aux2
                = _data.reserveFAssetUBADex1
                * _data.liquidationFactorPoolBips
                / MAX_BIPS
                * _data.priceFAssetPoolMul
                / _data.priceFAssetPoolDiv
                * feeFactorBipsDex2
                / DEX_MAX_BIPS
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
        _amount *= DEX_MAX_BIPS;
        _amount /= feeFactorBipsDex1;
        _amount /= _data.reservePoolWeiDex2;
    }

    // reduce the amount in such a way that once
    // it gets swapped through the dex1 path, it will
    // produce output that is a multiplier of AMG
    function getDexSwapAmountInForAmgMultiplier(
        EcosystemData memory _data,
        uint256 _amountIn
    ) internal pure returns (uint256) {
        for (uint256 i = 1; i < _data.dex1PathLength; i++) {
            _amountIn = getDexSwapAmountOut(
                _amountIn,
                _data.reserveVaultWeiDex1,
                _data.reserveFAssetUBADex1
            );
        }
        _amountIn = Math.min(
            roundUpWithPrecision(
                _amountIn,
                _data.assetMintingGranularityUBA
            ), _data.maxLiquidatedFAssetUBA
        );
        if (_amountIn == 0) return 0;
        for (uint256 i = 1; i < _data.dex1PathLength; i++) {
            _amountIn = getDexSwapAmountIn(
                _amountIn,
                _data.reserveVaultWeiDex1,
                _data.reserveFAssetUBADex1
            );
        }
        return Math.min(_amountIn, _data.reserveVaultWeiDex1);
    }

    // given an output amount of an asset and pair reserves,
    // returns a required input amount of the other asset
    function getDexSwapAmountIn(
        uint256 amountOut,
        uint256 reserveIn,
        uint256 reserveOut
    ) internal pure returns (uint256 amountIn) {
        uint256 numerator = reserveIn * amountOut * DEX_MAX_BIPS;
        uint256 denominator = (reserveOut - amountOut) * DEX_FACTOR_BIPS;
        amountIn = numerator / denominator + 1;
    }

    // given an input amount of an asset and pair reserves,
    // returns the maximum output amount of the other asset
    function getDexSwapAmountOut(
        uint256 amountIn,
        uint256 reserveIn,
        uint256 reserveOut
    ) internal pure returns (uint256 amountOut) {
        uint256 amountInWithFee = amountIn * DEX_FACTOR_BIPS;
        uint256 numerator = amountInWithFee * reserveOut;
        uint256 denominator = reserveIn * DEX_MAX_BIPS + amountInWithFee;
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