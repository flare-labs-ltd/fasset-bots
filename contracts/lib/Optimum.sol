// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

import "@openzeppelin/contracts/utils/math/Math.sol";
import "blazeswap/contracts/shared/libraries/Babylonian.sol";
import "./Structs.sol";
import "./Constants.sol";

import "hardhat/console.sol";

library Optimum {
    using Babylonian for uint256;

    function getFlashLoanedVaultCollateral(
        EcosystemData memory _data
    )
        internal pure
        returns (uint256)
    {
        bool numeric
            =  _data.reservePathDex1.length > 1
            || _data.reservePathDex2.length > 1;
        uint256 optFAssetAmg = numeric
            ? numericOptimalFAssetAmg(_data)
            : symbolicOptimalFAssetAmg(_data);
        // return 0 before it's too late
        if (optFAssetAmg == 0) return 0;
        uint256 optFAssetUba = _convertAmgToUba(
            Math.min(optFAssetAmg, _data.maxLiquidatedFAssetUBA),
            _data.assetMintingGranularityUBA
        );
        return _calcSwapAmountIn(optFAssetUba, _data.reservePathDex1);
    }

    function symbolicOptimalFAssetAmg(
        EcosystemData memory _data
    )
        internal pure
        returns (uint256 _amount)
    {
        // this formula only works with the default swap path!
        uint256 reserveVaultCT1 = _data.reservePathDex1[0].reserveA;
        uint256 reserveFAsset = _data.reservePathDex1[0].reserveB;
        uint256 reservePoolCT = _data.reservePathDex2[0].reserveA;
        uint256 reserveVaultCT2 = _data.reservePathDex2[0].reserveB;
        // to avoid overflow, we never multiply three non-bips vars
        // (two leave some space, as uniswap allows only 112-bit reserves)
        {
            // scope to avoid stack too deep error
            _amount
                = reserveVaultCT1
                * DEX_FACTOR_BIPS
                / DEX_MAX_BIPS
                * reservePoolCT;
            _amount = _amount.sqrt();
        }
        {
            // scope to avoid stack too deep error
            uint256 reserveFAssetAmg = _convertUbaToAmg(
                reserveFAsset,
                _data.assetMintingGranularityUBA
            );
            uint256 _aux1 = _convertFAssetAmgToToken(
                reserveFAssetAmg
                * _data.liquidationFactorVaultBips
                / MAX_BIPS
                * reservePoolCT,
                _data.priceFAssetAmgVaultCT
            );
            uint256 _aux2 = _convertFAssetAmgToToken(
                reserveFAssetAmg
                * _data.liquidationFactorPoolBips
                / MAX_BIPS
                * DEX_FACTOR_BIPS
                / DEX_MAX_BIPS
                * reserveVaultCT2,
                _data.priceFAssetAmgPoolCT
            );
            _amount *= (_aux1 + _aux2).sqrt();
        }
        {
            // scope to avoid stack too deep error
            uint256 _aux1
                = reserveVaultCT1
                * reservePoolCT;
            if (_aux1 >= _amount) {
                return 0;
            }
            _amount -= _aux1;
        }
        _amount *= DEX_MAX_BIPS;
        _amount /= DEX_FACTOR_BIPS;
        _amount /= reservePoolCT; // max vault collateral

        console.log(_amount);
        _amount = _convertUbaToAmg(
            _calcSwapAmountOut(_amount, reserveVaultCT1, reserveFAsset),
            _data.assetMintingGranularityUBA
        );

        console.log(_calcArbitrageProfit(_data, _amount));
    }

    // note: The method finds maximums on the edges of the interval
    function numericOptimalFAssetAmg(
        EcosystemData memory _data
    )
        internal pure
        returns (uint256)
    {
        // assume there's one maximum (probably is tho) and find it with "Golden Section Search"
        uint256 phi = 1618; // Approximation of the golden ratio * 1000
        uint256 invPhi = 1000; // Inverse of phi for fixed point math
        uint256 a = 0;
        uint256 b = _convertUbaToAmg(
            _data.maxLiquidatedFAssetUBA,
            _data.assetMintingGranularityUBA
        );
        for (uint256 i = 0; i < MAX_BISECTION_ITERATIONS; i++) {
            uint256 c = b - (b - a) * invPhi / phi;
            uint256 d = a + (b - a) * invPhi / phi;
            if (b - d <= BISECTION_PRECISION) {
                break;
            }
            uint256 profitAtC = _calcArbitrageProfit(_data, c);
            uint256 profitAtD = _calcArbitrageProfit(_data, d);
            if (profitAtC > profitAtD) {
                b = d;
            } else {
                a = c;
            }
        }
        uint256 max = (a + b) / 2;
        uint256 profitAtB = _calcArbitrageProfit(_data, b);
        uint256 profitAtMax = _calcArbitrageProfit(_data, max);
        if (profitAtMax == 0 && profitAtB == 0) {
           return 0;
        }
        if (profitAtMax <= profitAtB) {
            max = b;
        }
        return max;
    }

    ///////////////////////////////////////////////////////////////////////////////////////
    // helper functions

    function _calcArbitrageProfit(
        EcosystemData memory _data,
        uint256 _fAssetAmg
    )
        internal pure
        returns (uint256)
    {
        // create new array of reserves because changes are preserved between function calls?
        PoolReserves[] memory temp = new PoolReserves[](_data.reservePathDex2.length);
        for (uint256 i = 0; i < _data.reservePathDex2.length; i++) {
            temp[i] = PoolReserves({
                reserveA: _data.reservePathDex2[i].reserveA,
                reserveB: _data.reservePathDex2[i].reserveB
            });
        }
        // calculate the amount in along the path while/ also updating the reserves on dex2 path
        uint256 vaultAmount = _convertAmgToUba(_fAssetAmg, _data.assetMintingGranularityUBA);
        for (uint256 i = _data.reservePathDex1.length; i > 0; i--) {
            uint256 aux = _calcSwapAmountIn(
                vaultAmount,
                _data.reservePathDex1[i-1].reserveA,
                _data.reservePathDex1[i-1].reserveB
            );
            for (uint256 j = 1; j < _data.swapPathDex2.length; j++) {
                if (_data.swapPathDex2[j-1] == _data.swapPathDex1[i]
                    && _data.swapPathDex2[j] == _data.swapPathDex1[i-1]) {
                    temp[j-1].reserveA -= vaultAmount;
                    temp[j-1].reserveB += aux;
                } else if (_data.swapPathDex2[j-1] == _data.swapPathDex1[i-1]
                    && _data.swapPathDex2[j] == _data.swapPathDex1[i]) {
                    temp[j-1].reserveA -= aux;
                    temp[j-1].reserveB += vaultAmount;
                }
            }
            vaultAmount = aux;
        }
        (uint256 vaultLiquidationReward, uint256 poolLiquidationReward)
            = _calcLiquidationReward(_data, _fAssetAmg);
        uint256 swappedPool = _calcSwapAmountOut(poolLiquidationReward, temp);
        uint256 vaultTotalReward = vaultLiquidationReward + swappedPool;
        return vaultTotalReward > vaultAmount ? vaultTotalReward - vaultAmount : 0;
    }

    function _calcLiquidationReward(
        EcosystemData memory _data,
        uint256 _fassetAmg
    )
        internal pure
        returns (
            uint256 _vaultLiquidationReward,
            uint256 _poolLiquidationReward
        )
    {
        _vaultLiquidationReward = _convertFAssetAmgToToken(
            _fassetAmg
            * _data.liquidationFactorVaultBips
            / MAX_BIPS,
            _data.priceFAssetAmgVaultCT
        );
        _poolLiquidationReward = _convertFAssetAmgToToken(
            _fassetAmg
            * _data.liquidationFactorPoolBips
            / MAX_BIPS,
            _data.priceFAssetAmgPoolCT
        );
    }

    function _calcSwapAmountIn(
        uint256 _amountOut,
        PoolReserves[] memory _reservePath
    )
        private pure
        returns (uint256 _amountIn)
    {
        _amountIn = _amountOut;
        for (uint256 i = _reservePath.length; i > 0; i--) {
            _amountIn = _calcSwapAmountIn(
                _amountIn,
                _reservePath[i-1].reserveA,
                _reservePath[i-1].reserveB
            );
        }
    }

    function _calcSwapAmountOut(
        uint256 _amountIn,
        PoolReserves[] memory _reservePath
    )
        private pure
        returns (uint256 _amountOut)
    {
        _amountOut = _amountIn;
        for (uint256 i = 0; i < _reservePath.length; i++) {
            _amountOut = _calcSwapAmountOut(
                _amountOut,
                _reservePath[i].reserveA,
                _reservePath[i].reserveB
            );
        }
    }

    // given an output amount of an asset and pair reserves,
    // returns a required input amount of the other asset
    function _calcSwapAmountIn(
        uint256 amountOut,
        uint256 reserveIn,
        uint256 reserveOut
    )
        private pure
        returns (uint256 amountIn)
    {
        uint256 numerator = reserveIn * amountOut * DEX_MAX_BIPS;
        uint256 denominator = (reserveOut - amountOut) * DEX_FACTOR_BIPS;
        amountIn = numerator / denominator + 1;
    }

    // given an input amount of an asset and pair reserves,
    // returns the maximum output amount of the other asset
    function _calcSwapAmountOut(
        uint256 amountIn,
        uint256 reserveIn,
        uint256 reserveOut
    )
        private pure
        returns (uint256 amountOut)
    {
        uint256 amountInWithFee = amountIn * DEX_FACTOR_BIPS;
        uint256 numerator = amountInWithFee * reserveOut;
        uint256 denominator = reserveIn * DEX_MAX_BIPS + amountInWithFee;
        amountOut = numerator / denominator;
    }

    function _convertAmgToUba(
        uint256 _valueAMG,
        uint256 _amg
    )
        internal pure
        returns (uint256)
    {
        return _valueAMG * _amg;
    }

    function _convertUbaToAmg(
        uint256 _valueUBA,
        uint256 _amg
    )
        internal pure
        returns (uint256)
    {
        // rounds up the remainder
        return (_valueUBA + _amg - 1) / _amg;
    }

    function _convertFAssetAmgToToken(
        uint256 _valueAMG,
        uint256 _amgToTokenPrice
    )
        internal pure
        returns (uint256)
    {
        return _valueAMG * _amgToTokenPrice / AMG_TOKEN_WEI_PRICE_SCALE;
    }

}