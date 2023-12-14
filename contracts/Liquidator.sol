// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "fasset/contracts/fasset/interface/IFAsset.sol";
import "fasset/contracts/userInterfaces/IAssetManager.sol";
import "fasset/contracts/fasset/interface/IIAgentVault.sol";
import "./interface/ILiquidator.sol";
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
    IERC3156FlashLender public immutable flashLender;
    IBlazeSwapRouter public immutable blazeSwapRouter;

    // takes care of flash loan getting executed exactly once
    // when ran from runArbitrageWithCustomParams
    FlashLoanLock private status;

    constructor(
        IERC3156FlashLender _flashLender,
        IBlazeSwapRouter _blazeSwapRouter
    ) {
        flashLender = _flashLender;
        blazeSwapRouter = _blazeSwapRouter;
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
        address _to
    ) virtual public {
        runArbitrageWithCustomParams(
            _agentVault,
            flashLender,
            blazeSwapRouter,
            _to
        );
    }

    function runArbitrageWithCustomParams(
        address _agentVault,
        IERC3156FlashLender _flashLender,
        IBlazeSwapRouter _blazeSwapRouter,
        address _to
    ) virtual public {
        // we have to start liquidation so that we get correct max f-assets
        // this should probably be fixed in the later f-asset version
        IIAssetManager _assetManager = IIAgentVault(_agentVault).assetManager();
        _assetManager.startLiquidation(address(_agentVault));
        // run liquidation arbitrage
        Ecosystem.Data memory _data = Ecosystem.getData(
            _agentVault,
            address(_blazeSwapRouter),
            address(_flashLender)
        );
        _runArbitrageWithData(_data);
        // send earnings to sender (along with any tokens sent to this contract)
        uint256 earnings = IERC20(_data.vaultToken).balanceOf(address(this));
        SafeERC20.safeTransfer(IERC20(_data.vaultToken), _to, earnings);
    }

    // non-reentrant
    function _runArbitrageWithData(
        Ecosystem.Data memory _data
    ) internal flashLoanInitiatorLock {
        // check if any f-assets can be liquidated
        require(_data.maxLiquidatedFAssetUBA > 0, "Liquidator: No f-asset to liquidate");
        // get max and optimal vault collateral to flash loan
        uint256 maxVaultFlashLoan = IERC3156FlashLender(_data.flashLender).maxFlashLoan(_data.vaultToken);
        require(maxVaultFlashLoan > 0, "Liquidator: Flash loan unavailable");
        uint256 optimalVaultAmount = SymbolicOptimum.getFlashLoanedVaultCollateral(_data);
        require(optimalVaultAmount > 0, "Liquidator: No profit available");
        // run flash loan
        IERC3156FlashLender(_data.flashLender).flashLoan(
            this, _data.vaultToken,
            Math.min(maxVaultFlashLoan, optimalVaultAmount),
            abi.encode(
                _data.fAssetToken,
                _data.poolToken,
                _data.assetManager,
                _data.agentVault,
                _data.blazeSwapRouter
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
            IFAsset _fAssetToken,
            IERC20 _poolToken,
            IAssetManager _assetManager,
            IIAgentVault _agentVault,
            IBlazeSwapRouter _blazeSwapRouter
        ) = abi.decode(_data, (
            IFAsset,
            IERC20,
            IAssetManager,
            IIAgentVault,
            IBlazeSwapRouter
        ));
        _executeArbitrage(
            _amount,
            _fAssetToken,
            IERC20(_token),
            _poolToken,
            _assetManager,
            _agentVault,
            _blazeSwapRouter
        );
        // approve flash loan spending to flash lender
        IERC20(_token).approve(msg.sender, 0);
        IERC20(_token).approve(msg.sender, _amount + _fee);
        return keccak256("ERC3156FlashBorrower.onFlashLoan");
    }

    function _executeArbitrage(
        uint256 _vaultAmount,
        IFAsset _fAsset,
        IERC20 _vaultToken,
        IERC20 _poolToken,
        IAssetManager _assetManager,
        IAgentVault _agentVault,
        IBlazeSwapRouter _blazeSwapRouter
    ) internal {
        uint256[] memory amountsRecv;
        // swap vault collateral for f-asset
        _vaultToken.approve(address(_blazeSwapRouter), _vaultAmount);
        (, amountsRecv) = _blazeSwapRouter.swapExactTokensForTokens(
            _vaultAmount,
            0,
            toDynamicArray(address(_vaultToken), address(_fAsset)),
            address(this),
            block.timestamp
        );
        _vaultToken.approve(address(_blazeSwapRouter), 0);
        // liquidate obtained f-asset
        (,, uint256 obtainedPool) = _assetManager.liquidate(
            address(_agentVault),
            amountsRecv[1]
        );
        // swap pool for vault collateral
        if (obtainedPool > 0) {
            _poolToken.approve(address(_blazeSwapRouter), obtainedPool);
            (, amountsRecv) = _blazeSwapRouter.swapExactTokensForTokens(
                obtainedPool,
                0,
                toDynamicArray(address(_poolToken), address(_vaultToken)),
                address(this),
                block.timestamp
            );
            _poolToken.approve(address(_blazeSwapRouter), 0);
        }
    }

    function toDynamicArray(
        address _x,
        address _y
    ) private pure returns (address[] memory) {
        address[] memory _arr = new address[](2);
        _arr[0] = _x;
        _arr[1] = _y;
        return _arr;
    }
}
