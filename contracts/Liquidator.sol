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


struct DexPairConfig {
    address[] path;
    uint256 minPriceMul;
    uint256 minPriceDiv;
}
struct DexConfig {
    DexPairConfig vaultFAsset;
    DexPairConfig poolVault;
}

/**
 * Do not send any tokens to this contract, they can be stolen!
 * Security is not put in place because of gas cost savings.
 * Ideally, we would save the arbitrage data into storage and read it in
 * onFlashLoan, but this would cost too much gas.
 */
contract Liquidator is ILiquidator {

    enum FlashLoanLock { INACTIVE, INITIATOR_ENTER, RECEIVER_ENTER }

    // those are initialized once and cannot be changed
    address public immutable flashLender;
    address public immutable dex;

    // takes care of flash loan getting executed exactly once
    FlashLoanLock private status;

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
        address _flashLender,
        address _dex,
        uint256 _vaultToFAssetMinDexPriceMul,
        uint256 _vaultToFAssetMinDexPriceDiv,
        uint256 _poolToVaultMinDexPriceMul,
        uint256 _poolToVaultMinDexPriceDiv,
        address[] memory _vaultToFAssetDexPath,
        address[] memory _poolToVaultDexPath
    )
        public
    {
        DexConfig memory dexConfig = DexConfig({
            vaultFAsset: DexPairConfig({
                path: _vaultToFAssetDexPath,
                minPriceMul: _vaultToFAssetMinDexPriceMul,
                minPriceDiv: _vaultToFAssetMinDexPriceDiv
            }),
            poolVault: DexPairConfig({
                path: _poolToVaultDexPath,
                minPriceMul: _poolToVaultMinDexPriceMul,
                minPriceDiv: _poolToVaultMinDexPriceDiv
            })
        });
        _runArbitrage(
            _agentVault,
            _profitTo,
            _flashLender == address(0) ? flashLender : _flashLender,
            _dex == address(0) ? dex : _dex,
            dexConfig
        );
    }

    function _runArbitrage(
        address _agentVault,
        address _profitTo,
        address _flashLender,
        address _dex,
        DexConfig memory _dexConfig
    )
        internal virtual
    {
        // we have to start liquidation so that we get correct max f-assets
        // this should be fixed within the asset manager implementation
        IIAssetManager assetManager = IIAgentVault(_agentVault).assetManager();
        assetManager.startLiquidation(_agentVault);
        // run liquidation arbitrage
        Ecosystem.Data memory data = Ecosystem.getData(_agentVault, _dex, _flashLender);
        _runArbitrageWithData(data, _fillDexConfigDefaultPaths(data, _dexConfig));
        // send earnings to sender (along with any tokens sent to this contract)
        uint256 earnings = IERC20(data.vaultToken).balanceOf(address(this));
        SafeERC20.safeTransfer(IERC20(data.vaultToken), _profitTo, earnings);
    }

    // non-reentrant
    function _runArbitrageWithData(
        Ecosystem.Data memory _data,
        DexConfig memory _dexConfig
    )
        internal
        flashLoanInitiatorLock
    {
        // check if any f-assets can be liquidated
        require(_data.maxLiquidatedFAssetUBA > 0, "Liquidator: No f-asset to liquidate");
        // get max and optimal vault collateral to flash loan
        uint256 maxVaultFlashLoan = IERC3156FlashLender(_data.flashLender)
            .maxFlashLoan(_data.vaultToken);
        require(maxVaultFlashLoan > 0, "Liquidator: Flash loan unavailable");
        uint256 optimalVaultAmount = SymbolicOptimum.getFlashLoanedVaultCollateral(_data);
        require(optimalVaultAmount > 0, "Liquidator: No profit available");
        // run flash loan
        IERC3156FlashLender(_data.flashLender).flashLoan(
            this, _data.vaultToken,
            Math.min(maxVaultFlashLoan, optimalVaultAmount),
            abi.encode(
                _data.poolToken,
                _data.assetManager,
                _data.agentVault,
                _data.dex,
                _dexConfig
            )
        );
    }

    // dangerous!
    // - cannot reenter due to flashLoanReceiverLock
    // - can only be run once from runArbitrageWithCustomParams call
    // - function arguments can be faked by a malicious flash lender!
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
        // execute arbitrage
        (
            address _poolToken,
            address _assetManager,
            address _agentVault,
            address _dex,
            DexConfig memory _dexConfig
        ) = abi.decode(_data, (
            address,
            address,
            address,
            address,
            DexConfig
        ));
        _executeArbitrage(
            _amount,
            _token,
            _poolToken,
            _assetManager,
            _agentVault,
            _dex,
            _dexConfig
        );
        // approve flash loan spending to flash lender
        IERC20(_token).approve(msg.sender, 0);
        IERC20(_token).approve(msg.sender, _amount + _fee);
        return keccak256("ERC3156FlashBorrower.onFlashLoan");
    }

    function _executeArbitrage(
        uint256 _vaultAmount,
        address _vaultToken,
        address _poolToken,
        address _assetManager,
        address _agentVault,
        address _dex,
        DexConfig memory _dexConfig
    )
        internal
    {
        uint256[] memory amountsRecv;
        // swap vault collateral for f-asset
        IERC20(_vaultToken).approve(_dex, _vaultAmount);
        (, amountsRecv) = IBlazeSwapRouter(_dex).swapExactTokensForTokens(
            _vaultAmount,
            _convert(
                _vaultAmount,
                _dexConfig.vaultFAsset.minPriceMul,
                _dexConfig.vaultFAsset.minPriceDiv
            ),
            _dexConfig.vaultFAsset.path,
            address(this),
            block.timestamp
        );
        IERC20(_vaultToken).approve(_dex, 0);
        // liquidate obtained f-asset
        uint256 obtainedFAsset = amountsRecv[amountsRecv.length - 1];
        (,, uint256 obtainedPool) = IAssetManager(_assetManager).liquidate(
            _agentVault,
            obtainedFAsset
        );
        // swap pool for vault collateral
        if (obtainedPool > 0) {
            IERC20(_poolToken).approve(_dex, obtainedPool);
            (, amountsRecv) = IBlazeSwapRouter(_dex).swapExactTokensForTokens(
                obtainedPool,
                _convert(
                    obtainedPool,
                    _dexConfig.poolVault.minPriceMul,
                    _dexConfig.poolVault.minPriceDiv
                ),
                _dexConfig.poolVault.path,
                address(this),
                block.timestamp
            );
            IERC20(_poolToken).approve(_dex, 0);
        }
    }

    function _fillDexConfigDefaultPaths(
        Ecosystem.Data memory _data,
        DexConfig memory _dexConfig
    )
        internal pure
        returns (DexConfig memory)
    {
        if (_dexConfig.vaultFAsset.path.length == 0) {
            _dexConfig.vaultFAsset.path = _toDynamicArray(
                _data.vaultToken,
                _data.fAssetToken
            );
        }
        if (_dexConfig.poolVault.path.length == 0) {
            _dexConfig.poolVault.path = _toDynamicArray(
                _data.poolToken,
                _data.vaultToken
            );
        }
        return _dexConfig;
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
        returns (address[] memory _arr)
    {
        _arr[0] = _x;
        _arr[1] = _y;
        return _arr;
    }
}