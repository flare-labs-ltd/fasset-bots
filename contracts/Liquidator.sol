// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
import "fasset/contracts/fasset/interface/IFAsset.sol";
import "fasset/contracts/userInterfaces/IAssetManager.sol";
import "./interface/ILiquidator.sol";
import "./lib/SymbolicOptimum.sol";
import "./lib/Ecosystem.sol";


enum FlashLoanLock { INACTIVE, INITIATOR_ENTER, RECEIVER_ENTER }

// always assume pool = wrapped native
contract Liquidator is ILiquidator, Ownable {

    // those are initialized once and cannot be changed
    IERC3156FlashLender public immutable flashLender;
    IBlazeSwapRouter public immutable blazeSwapRouter;

    // takes care of flash loan getting executed exactly once
    // when ran from runArbitrageWithCustomParams
    FlashLoanLock private _status;

    constructor(
        IERC3156FlashLender _flashLender,
        IBlazeSwapRouter _blazeSwapRouter
    ) Ownable() {
        flashLender = _flashLender;
        blazeSwapRouter = _blazeSwapRouter;
    }

    modifier flashLoanInitiatorLock() {
        require(_status == FlashLoanLock.INACTIVE,
            "Liquidator: Reentrancy blocked");
        _status = FlashLoanLock.INITIATOR_ENTER;
        _;
        require(_status == FlashLoanLock.RECEIVER_ENTER,
            "Liquidator: Reentrancy blocked or flash loan receiver not called");
        _status = FlashLoanLock.INACTIVE;
    }

    modifier flashLoanReceiverLock() {
        require(_status == FlashLoanLock.INITIATOR_ENTER,
            "Liquidator: Flash loan with invalid initiator");
        _status = FlashLoanLock.RECEIVER_ENTER;
        _;
    }

    function runArbitrage(
        IIAgentVault _agentVault
    ) external {
        runArbitrageWithCustomParams(_agentVault, flashLender, blazeSwapRouter);
    }

    function runArbitrageWithCustomParams(
        IIAgentVault _agentVault,
        IERC3156FlashLender _flashLender,
        IBlazeSwapRouter _blazeSwapRouter
    ) public {
        _runArbitrageWithData(
            Ecosystem.getData(
                address(_agentVault),
                address(_blazeSwapRouter),
                address(_flashLender)
            )
        );
    }

    // non-reentrant
    function _runArbitrageWithData(Ecosystem.Data memory _data) internal flashLoanInitiatorLock {
        // send vault collateral to owner, to avoid them being stolen by a malicious flash
        // loan contract, and also to ensure that arbitrage fails in case of decreased funds
        // (owner should not be agentVault or any of the dexes)
        IERC20(_data.vaultToken).transfer(owner(), IERC20(_data.vaultToken).balanceOf(address(this)));
        // get max and optimal vault collateral to flash loan
        uint256 maxVaultFlashLoan = flashLender.maxFlashLoan(_data.vaultToken);
        require(maxVaultFlashLoan > 0, "Liquidator: No flash loan available");
        uint256 optimalVaultAmount = SymbolicOptimum.getFlashLoanedVaultCollateral(_data);
        require(optimalVaultAmount > 0, "Liquidator: No profitable arbitrage opportunity");
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
        // send earnings to sender
        IERC20(_data.vaultToken).transfer(msg.sender, IERC20(_data.vaultToken).balanceOf(address(this)));
    }

    // dangerous!
    // - cannot reenter due to flashLoanReceiverLock
    // - can only be run once from runArbitrageWithCustomParams call
    // - runArbitrageWithCustomParams: _token is always vault collateral
    // - runArbitrageWithCustomParams: contract vault balance at each call is 0
    function onFlashLoan(
        address /* _initiator */,
        address _token,
        uint256 _amount,
        uint256 _fee,
        bytes calldata _data
    ) external flashLoanReceiverLock returns (bytes32) {
        // check that starting contract vault collateral balance
        // is correct (note that anyone can call onFlashLoan)
        require(IERC20(_token).balanceOf(address(this)) == _amount,
            "Liquidator: Incorrect flash loan amount");
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
        IERC20(_token).approve(address(msg.sender), _amount + _fee);
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

    function withdrawToken(IERC20 token) external onlyOwner {
        token.transfer(owner(), token.balanceOf(address(this)));
    }

    function withderawNat() external onlyOwner {
        payable(owner()).transfer(address(this).balance);
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
