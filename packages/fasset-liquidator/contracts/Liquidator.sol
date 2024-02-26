// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IERC3156FlashLender} from "@openzeppelin/contracts/interfaces/IERC3156FlashLender.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IAssetManager, IIAssetManager} from "fasset/contracts/fasset/interface/IIAssetManager.sol";
import {IIAgentVault} from "fasset/contracts/fasset/interface/IIAgentVault.sol";
import {ILiquidator} from "./interface/ILiquidator.sol";
import {ArbitrageConfig, EcosystemData, DexPairConfig} from "./lib/Structs.sol";
import {UniswapV2} from "./lib/UniswapV2.sol";
import {Ecosystem} from "./lib/Ecosystem.sol";
import {Optimum} from "./lib/Optimum.sol";


/**
 * It is recommended for each person to deploy their own ownable
 * liquidator contract to avoid flash bots stealing the arbitrage profits.
 * Note: f-assets within the contract are not safe from being liquidated by a malicious actor,
 * Note: the supported dexes right now are those interfaced with either IEnosysDexRouter or IBlazeSwapRouter
 */
contract Liquidator is ILiquidator {
    using UniswapV2 for address;

    enum FlashLoanLock { INACTIVE, INITIATOR_ENTER, RECEIVER_ENTER }

    // change those by redeploying the contract
    address public immutable flashLender;
    address public immutable dex;

    // one storage slot
    FlashLoanLock private status; // uint8
    bytes31 private hash; // truncated keccak256

    constructor(
        address _flashLender,
        address _dex
    ) {
        flashLender = _flashLender;
        dex = _dex;
    }

    modifier flashLoanInitiatorLock() {
        require(status == FlashLoanLock.INACTIVE,
            "Liquidator: Reentrancy blocked");
        status = FlashLoanLock.INITIATOR_ENTER;
        _;
        require(status == FlashLoanLock.RECEIVER_ENTER,
            "Liquidator: Reentrancy blocked or flash loan receiver not called");
        status = FlashLoanLock.INACTIVE;
    }

    modifier flashLoanReceiverLock() {
        require(status == FlashLoanLock.INITIATOR_ENTER,
            "Liquidator: Flash loan with invalid initiator");
        status = FlashLoanLock.RECEIVER_ENTER;
        _;
    }

    function runArbitrage(
        address _agentVault,
        address _profitTo,
        uint256 _vaultToFAssetMinDexPriceMul,
        uint256 _vaultToFAssetMinDexPriceDiv,
        uint256 _poolToVaultMinDexPriceMul,
        uint256 _poolToVaultMinDexPriceDiv,
        address _flashLender,
        address _dex,
        address[] memory _vaultToFAssetDexPath,
        address[] memory _poolToVaultDexPath
    )
        public virtual
    {
        if (address(_flashLender) == address(0)) {
            _flashLender = flashLender;
        }
        if (address(_dex) == address(0)) {
            _dex = dex;
        }
        ArbitrageConfig memory config = ArbitrageConfig({
            flashLender: address(_flashLender),
            dex: address(_dex),
            dexPair1: DexPairConfig({
                path: _vaultToFAssetDexPath,
                minPriceMul: _vaultToFAssetMinDexPriceMul,
                minPriceDiv: _vaultToFAssetMinDexPriceDiv
            }),
            dexPair2: DexPairConfig({
                path: _poolToVaultDexPath,
                minPriceMul: _poolToVaultMinDexPriceMul,
                minPriceDiv: _poolToVaultMinDexPriceDiv
            })
        });
        _runArbitrage(_agentVault, _profitTo, config);
    }

    function maxSlippageToMinPrices(
        uint256 _maxSlippageBipsDex1,
        uint256 _maxSlippageBipsDex2,
        address _agentVault
    )
        external view
        returns (uint256, uint256, uint256, uint256)
    {
        address _dex = dex; // gas savings
        EcosystemData memory data = Ecosystem.getFAssetData(_agentVault);
        (uint256 minPriceMul1, uint256 minPriceDiv1) = _maxSlippageToMinPrice(
            _dex, _maxSlippageBipsDex1, data.vaultCT, data.fAssetToken);
        (uint256 minPriceMul2, uint256 minPriceDiv2) = _maxSlippageToMinPrice(
            _dex, _maxSlippageBipsDex2, data.poolCT, data.vaultCT);
        return (minPriceMul1, minPriceDiv1, minPriceMul2, minPriceDiv2);
    }

    function _runArbitrage(
        address _agentVault,
        address _profitTo,
        ArbitrageConfig memory _config
    )
        internal
    {
        // we have to start liquidation so that we get correct max f-assets
        // this should be fixed within the asset manager implementation!
        IIAssetManager assetManager = IIAgentVault(_agentVault).assetManager();
        assetManager.startLiquidation(_agentVault);
        // get data needed for arbitrage strategy calculation
        EcosystemData memory data = Ecosystem.getFAssetData(_agentVault);
        _config.dexPair1.path = _getEnsurePath(
            _config.dexPair1.path, data.vaultCT, data.fAssetToken);
        _config.dexPair2.path = _getEnsurePath(
            _config.dexPair2.path, data.poolCT, data.vaultCT);
        data.reservePathDex1 = Ecosystem.getDexReserves(
            _config.dex, _config.dexPair1.path);
        data.reservePathDex2 = Ecosystem.getDexReserves(
            _config.dex, _config.dexPair2.path);
        data.swapPathDex1 = _config.dexPair1.path;
        data.swapPathDex2 = _config.dexPair2.path;
        // run arbitrage
        uint256 vaultBalanceBefore = IERC20(data.vaultCT).balanceOf(address(this));
        uint256 poolBalanceBefore = IERC20(data.poolCT).balanceOf(address(this));
        _runArbitrageWithData(_config, data);
        uint256 vaultBalanceAfter = IERC20(data.vaultCT).balanceOf(address(this));
        uint256 poolBalanceAfter = IERC20(data.poolCT).balanceOf(address(this));
        // ensure no collaterals were stolen from the contract
        require(
            vaultBalanceAfter >= vaultBalanceBefore &&
            poolBalanceAfter >= poolBalanceBefore,
            "Liquidator: Negative profit would decrease contract balance"
        );
        // send the profit to the specified address
        uint256 profit = vaultBalanceAfter - vaultBalanceBefore;
        SafeERC20.safeTransfer(IERC20(data.vaultCT), _profitTo, profit);
    }

    // non-reentrant
    function _runArbitrageWithData(
        ArbitrageConfig memory _config,
        EcosystemData memory _data
    )
        internal
        flashLoanInitiatorLock
    {
        require(_data.maxLiquidatedFAssetUBA > 0, "Liquidator: No f-asset to liquidate");
        uint256 maxVaultFlashLoan = IERC3156FlashLender(_config.flashLender)
            .maxFlashLoan(_data.vaultCT);
        require(maxVaultFlashLoan > 0, "Liquidator: Flash loan unavailable");
        uint256 optimalVaultAmount = Optimum.getFlashLoanedVaultCollateral(_data);
        require(optimalVaultAmount > 0, "Liquidator: No profit available");
        // run flash loan
        bytes memory encodedParams = abi.encode(
            _data.assetManager,
            _data.agentVault,
            _config
        );
        hash = bytes31(keccak256(encodedParams));
        IERC3156FlashLender(_config.flashLender).flashLoan(
            this,
            _data.vaultCT,
            Math.min(maxVaultFlashLoan, optimalVaultAmount),
            encodedParams
        );
        IERC20(_data.vaultCT).approve(_config.flashLender, 0);
    }

    // dangerous!
    // - cannot reenter due to flashLoanReceiverLock
    // - can only be run once from runArbitrageWithCustomParams call
    // - function arguments can't be faked by a malicious flash lender
    function onFlashLoan(
        address /* _initiator */,
        address _token,
        uint256 _amount,
        uint256 _fee,
        bytes calldata _data
    )
        external
        flashLoanReceiverLock
        returns (bytes32)
    {
        require(hash == bytes31(keccak256(_data)),
            "Liquidator: Flash lender passed invalid data");
        (
            address _assetManager,
            address _agentVault,
            ArbitrageConfig memory _config
        ) = abi.decode(_data, (
            address,
            address,
            ArbitrageConfig
        ));
        require(_token == _config.dexPair1.path[0],
            "Liquidator: Flash lender passed invalid token");
        _executeStrategy(_amount, _assetManager, _agentVault, _config);
        IERC20(_token).approve(_config.flashLender, _amount + _fee);
        return keccak256("ERC3156FlashBorrower.onFlashLoan");
    }

    function _executeStrategy(
        uint256 _vaultAmount,
        address _assetManager,
        address _agentVault,
        ArbitrageConfig memory _config
    )
        internal
    {
        uint256[] memory amountsRecv;
        uint256[] memory amountsSent;
        address vaultCT = _config.dexPair1.path[0];
        address poolCT = _config.dexPair2.path[0];
        // swap vault collateral for f-asset
        IERC20(vaultCT).approve(_config.dex, _vaultAmount);
        (amountsSent, amountsRecv) = _config.dex.swapExactTokensForTokens(
            _vaultAmount,
            _convert(
                _vaultAmount,
                _config.dexPair1.minPriceMul,
                _config.dexPair1.minPriceDiv
            ),
            _config.dexPair1.path,
            address(this),
            block.timestamp
        );
        IERC20(vaultCT).approve(_config.dex, 0);
        // liquidate obtained f-asset
        uint256 obtainedFAsset = amountsRecv[amountsRecv.length-1];
        (,, uint256 obtainedPool) = IAssetManager(_assetManager).liquidate(
            _agentVault,
            obtainedFAsset
        );
        if (obtainedPool > 0) {
            // swap pool for vault collateral
            IERC20(poolCT).approve(_config.dex, obtainedPool);
            (, amountsRecv) = _config.dex.swapExactTokensForTokens(
                obtainedPool,
                _convert(
                    obtainedPool,
                    _config.dexPair2.minPriceMul,
                    _config.dexPair2.minPriceDiv
                ),
                _config.dexPair2.path,
                address(this),
                block.timestamp
            );
            IERC20(poolCT).approve(_config.dex, 0);
        }
    }

    function _maxSlippageToMinPrice(
        address _dex,
        uint256 _maxSlippageBips,
        address _tokenA,
        address _tokenB
    )
        internal view
        returns (uint256, uint256)
    {
        (uint256 reservesA, uint256 reservesB) = _dex.getReserves(_tokenA, _tokenB);
        uint256 minPriceMul = reservesB * (10000 - _maxSlippageBips);
        uint256 minPriceDiv = reservesA * 10000;
        return (minPriceMul, minPriceDiv);
    }

    function _getEnsurePath(
        address[] memory _path,
        address _tokenIn,
        address _tokenOut
    )
        private pure
        returns (address[] memory)
    {
        if (_path.length == 0) {
            return _toDynamicArray(_tokenIn, _tokenOut);
        }
        require(_path[0] == _tokenIn && _path[_path.length-1] == _tokenOut,
            "Liquidator: Invalid token path");
        return _path;
    }

    function _convert(
        uint256 _amount,
        uint256 _priceMul,
        uint256 _priceDiv
    )
        private pure
        returns (uint256)
    {
        return _amount * _priceMul / _priceDiv;
    }

    function _toDynamicArray(
        address _x,
        address _y
    )
        private pure
        returns (address[] memory)
    {
        address[] memory arr = new address[](2);
        arr[0] = _x;
        arr[1] = _y;
        return arr;
    }
}