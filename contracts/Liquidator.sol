// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/interfaces/IERC3156FlashLender.sol";
import "@openzeppelin/contracts/interfaces/IERC3156FlashBorrower.sol";
import "fasset/contracts/userInterfaces/IAssetManager.sol";
import "fasset/contracts/fasset/interface/IIAgentVault.sol";
import "./lib/Constants.sol";
import "./lib/SymbolicOptimum.sol";
import "./lib/Ecosystem.sol";
import "./interface/ILiquidator.sol";


/**
 * Do not send any tokens to this contract, they can be stolen!
 * Security is not put in place because of gas cost savings.
 * Ideally, we would save the arbitrage data into storage and read it in
 * onFlashLoan, but this would cost too much gas.
 *
 * It is recommended for each person to deploy their own ownable
 * liquidator contract to avoid flash bots stealing the arbitrage profits.
 */
contract Liquidator is ILiquidator {

    enum FlashLoanLock { INACTIVE, INITIATOR_ENTER, RECEIVER_ENTER }

    // those are initialized once and cannot be changed
    address public immutable flashLender;
    address public immutable dex;

    // takes care of flash loan getting executed exactly once
    FlashLoanLock private status; // uint8
    bytes31 private hash; // truncated keccak256 so it fits into one storage slot

    constructor(
        IERC3156FlashLender _flashLender,
        IBlazeSwapRouter _dex
    ) {
        flashLender = address(_flashLender);
        dex = address(_dex);
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
        public
    {
        if (_flashLender == address(0)) {
            _flashLender = flashLender;
        }
        if (_dex == address(0)) {
            _dex = dex;
        }
        ArbitrageConfig memory config = ArbitrageConfig({
            flashLender: _flashLender,
            dex: _dex,
            dex1: DexPairConfig({
                path: _vaultToFAssetDexPath,
                minPriceMul: _vaultToFAssetMinDexPriceMul,
                minPriceDiv: _vaultToFAssetMinDexPriceDiv
            }),
            dex2: DexPairConfig({
                path: _poolToVaultDexPath,
                minPriceMul: _poolToVaultMinDexPriceMul,
                minPriceDiv: _poolToVaultMinDexPriceDiv
            })
        });
        _runArbitrage(_agentVault, _profitTo, config);
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
        // get data (path length determines for dex fees)
        EcosystemData memory data = Ecosystem.getData(_agentVault, _config.dex);
        data.dex1PathLength = Math.max(_config.dex1.path.length, 2);
        data.dex2PathLength = Math.max(_config.dex2.path.length, 2);
        // run arbitrage
        uint256 balanceBefore = IERC20(data.vaultToken).balanceOf(address(this));
        _runArbitrageWithData(data, _fillDexConfigDefaultPaths(
            _config,
            data.fAssetToken,
            data.vaultToken,
            data.poolToken
        ));
        uint256 balanceAfter = IERC20(data.vaultToken).balanceOf(address(this));
        // send profit to sender
        uint256 profit = balanceAfter - balanceBefore; // revert if negative
        SafeERC20.safeTransfer(IERC20(data.vaultToken), _profitTo, profit);
    }

    // non-reentrant
    function _runArbitrageWithData(
        EcosystemData memory _data,
        ArbitrageConfig memory _config
    )
        internal
        flashLoanInitiatorLock
    {
        // check if any f-assets can be liquidated
        require(_data.maxLiquidatedFAssetUBA > 0, "Liquidator: No f-asset to liquidate");
        // get max and optimal vault collateral to flash loan
        uint256 maxVaultFlashLoan = IERC3156FlashLender(_config.flashLender)
            .maxFlashLoan(_data.vaultToken);
        require(maxVaultFlashLoan > 0, "Liquidator: Flash loan unavailable");
        uint256 optimalVaultAmount = SymbolicOptimum.getFlashLoanedVaultCollateral(_data);
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
            _data.vaultToken,
            Math.min(maxVaultFlashLoan, optimalVaultAmount),
            encodedParams
        );
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
        // ensure the validity of _data
        require(hash == bytes31(keccak256(_data)),
            "Liquidator: Flash lender passed invalid data");
        // unpack _data
        (
            address _assetManager,
            address _agentVault,
            ArbitrageConfig memory _config
        ) = abi.decode(_data, (
            address,
            address,
            ArbitrageConfig
        ));
        // ensure the validity of _token
        // _amount can be safely invalid, _fee is chosen by flash lender
        require(_token == _config.dex1.path[0],
            "Liquidator: Flash lender passed invalid data");
        // execute arbitrage
        _executeArbitrage( _amount, _assetManager, _agentVault, _config);
        // approve flash loan spending to flash lender
        IERC20(_token).approve(msg.sender, 0);
        IERC20(_token).approve(msg.sender, _amount + _fee);
        return keccak256("ERC3156FlashBorrower.onFlashLoan");
    }

    function _executeArbitrage(
        uint256 _vaultAmount,
        address _assetManager,
        address _agentVault,
        ArbitrageConfig memory _config
    )
        internal
    {
        uint256[] memory amountsRecv;
        address vaultToken = _config.dex1.path[0];
        address poolToken = _config.dex2.path[0];
        // swap vault collateral for f-asset
        IERC20(vaultToken).approve(_config.dex, _vaultAmount);
        (, amountsRecv) = IBlazeSwapRouter(_config.dex).swapExactTokensForTokens(
            _vaultAmount,
            _convert(
                _vaultAmount,
                _config.dex1.minPriceMul,
                _config.dex1.minPriceDiv
            ),
            _config.dex1.path,
            address(this),
            block.timestamp
        );
        IERC20(vaultToken).approve(_config.dex, 0);
        // liquidate obtained f-asset
        uint256 obtainedFAsset = amountsRecv[amountsRecv.length - 1];
        (,, uint256 obtainedPool) = IAssetManager(_assetManager).liquidate(
            _agentVault,
            obtainedFAsset
        );
        if (obtainedPool > 0) {
            // swap pool for vault collateral
            IERC20(poolToken).approve(_config.dex, obtainedPool);
            (, amountsRecv) = IBlazeSwapRouter(_config.dex).swapExactTokensForTokens(
                obtainedPool,
                _convert(
                    obtainedPool,
                    _config.dex2.minPriceMul,
                    _config.dex2.minPriceDiv
                ),
                _config.dex2.path,
                address(this),
                block.timestamp
            );
            IERC20(poolToken).approve(_config.dex, 0);
        }
    }

    function _fillDexConfigDefaultPaths(
        ArbitrageConfig memory _config,
        address _fAssetToken,
        address _vaultToken,
        address _poolToken
    )
        internal pure
        returns (ArbitrageConfig memory)
    {
        if (_config.dex1.path.length == 0) {
            _config.dex1.path = _toDynamicArray(_vaultToken, _fAssetToken);
        } else {
            uint256 len = _config.dex1.path.length;
            require(
                len > 2 &&
                _config.dex1.path[0] == _vaultToken &&
                _config.dex1.path[len - 1] == _fAssetToken,
                "Liquidator: Invalid vault to f-asset dex path");
        }
        if (_config.dex2.path.length == 0) {
            _config.dex2.path = _toDynamicArray(_poolToken, _vaultToken);
        } else {
            uint256 len = _config.dex2.path.length;
            require(
                len > 2 &&
                _config.dex2.path[0] == _poolToken &&
                _config.dex2.path[len - 1] == _vaultToken,
                "Liquidator: Invalid pool to vault dex path");
        }
        return _config;
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