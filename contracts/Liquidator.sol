// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/interfaces/IERC3156FlashLender.sol";
import "fasset/contracts/fasset/interface/IFAsset.sol";
import "fasset/contracts/userInterfaces/IAssetManager.sol";
import "fasset/contracts/fasset/interface/IIAgentVault.sol";
import "./interface/ILiquidator.sol";
import "./lib/Constants.sol";
import "./lib/SymbolicOptimum.sol";
import "./lib/Ecosystem.sol";


/**
 * Do not send any tokens to this contract, they can be stolen!
 * Security is not put in place because of gas cost savings.
 * Ideally, we would save the hash of the data passed into
 * flash loan to storage, and validate it in onFlashLoan, then also check
 * that no funds were stolen for the three relevant tokens.
 * Also _approve(token, 0) would need to be called after each swap.
 */

// Arbitrage is run without any funds sent to the contract.
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
        address _profitTo
    )
        public virtual
    {
        DexConfig memory dexConfig;
        runArbitrageWithCustomParams(
            _agentVault,
            _profitTo,
            flashLender,
            dex,
            dexConfig
        );
    }

    function runArbitrageWithCustomParams(
        address _agentVault,
        address _profitTo,
        address _flashLender,
        address _dex,
        DexConfig memory _dexConfig
    )
        public virtual
    {
        // we have to start liquidation so that we get correct max f-assets
        // this should be fixed within the asset manager implementation
        IIAssetManager assetManager = IIAgentVault(_agentVault).assetManager();
        assetManager.startLiquidation(_agentVault);
        // run liquidation arbitrage
        Ecosystem.Data memory data = Ecosystem.getData(_agentVault, _dex, _flashLender);
        _runArbitrageWithData(data, _extendDexConfig(data, _dexConfig));
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
            _minOut(_dex, _vaultAmount, _dexConfig.maxSlippageBips),
            _dexConfig.vaultToFAssetPath,
            address(this),
            block.timestamp
        );
        IERC20(_vaultToken).approve(_dex, 0);
        // liquidate obtained f-asset
        (,, uint256 obtainedPool) = IAssetManager(_assetManager).liquidate(
            _agentVault,
            amountsRecv[1]
        );
        // swap pool for vault collateral
        if (obtainedPool > 0) {
            IERC20(_poolToken).approve(_dex, obtainedPool);
            (, amountsRecv) = IBlazeSwapRouter(_dex).swapExactTokensForTokens(
                obtainedPool,
                _minOut(_dex, obtainedPool, _dexConfig.maxSlippageBips),
                _dexConfig.poolToVaultPath,
                address(this),
                block.timestamp
            );
            IERC20(_poolToken).approve(_dex, 0);
        }
    }

    function _extendDexConfig(
        Ecosystem.Data memory _data,
        DexConfig memory _dexConfig
    )
        internal pure
        returns (DexConfig memory)
    {
        if (_dexConfig.vaultToFAssetPath.length == 0) {
            _dexConfig.vaultToFAssetPath = _toDynamicArray(
                _data.vaultToken,
                _data.fAssetToken
            );
        }
        if (_dexConfig.poolToVaultPath.length == 0) {
            _dexConfig.poolToVaultPath = _toDynamicArray(
                _data.poolToken,
                _data.vaultToken
            );
        }
        if (_dexConfig.maxSlippageBips == 0) {
            _dexConfig.maxSlippageBips = MAX_SLIPPAGE_BIPS;
        }
        return _dexConfig;
    }

    // todo: define using a price oracle
    function _minOut(
        address /* _dex */,
        uint256 /* _amountIn */,
        uint256 /* _maxSlippageBips */
    )
        private pure
        returns (uint256)
    {
        return 0;
    }

    function _toDynamicArray(
        address _x,
        address _y
    )
        private pure
        returns (address[] memory)
    {
        address[] memory _arr = new address[](2);
        _arr[0] = _x;
        _arr[1] = _y;
        return _arr;
    }
}
