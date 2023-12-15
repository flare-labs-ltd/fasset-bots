// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
import "./interface/IChallenger.sol";
import "./Liquidator.sol";

// todo: challenge reward can get stuck in the contract
// which has vulnerabilities that allow those funds to be stolen
contract Challenger is IChallenger, Liquidator, Ownable {

    constructor(
        IERC3156FlashLender _flashLender,
        IBlazeSwapRouter _blazeSwap
    ) Liquidator(_flashLender, _blazeSwap) {}

    function illegalPaymentChallenge(
        BalanceDecreasingTransaction.Proof calldata _transaction,
        address _agentVault
    ) public onlyOwner {
        IAssetManager assetManager = IIAgentVault(_agentVault).assetManager();
        assetManager.illegalPaymentChallenge(_transaction, _agentVault);
        // if liquidation fails, we don't want to revert the made challenge
        try this.runArbitrage(_agentVault, address(this)) {} catch (bytes memory) {}
    }

    function doublePaymentChallenge(
        BalanceDecreasingTransaction.Proof calldata _payment1,
        BalanceDecreasingTransaction.Proof calldata _payment2,
        address _agentVault
    ) public onlyOwner {
        IAssetManager assetManager = IIAgentVault(_agentVault).assetManager();
        assetManager.doublePaymentChallenge( _payment1, _payment2, _agentVault);
        // if liquidation fails, we don't want to revert the made challenge
        try this.runArbitrage(_agentVault, address(this)) {} catch (bytes memory) {}
    }

    function freeBalanceNegativeChallenge(
        BalanceDecreasingTransaction.Proof[] calldata _payments,
        address _agentVault
    ) public onlyOwner {
        IAssetManager assetManager = IIAgentVault(_agentVault).assetManager();
        assetManager.freeBalanceNegativeChallenge(_payments, _agentVault);
        // if liquidation fails, we don't want to revert the made challenge
        try this.runArbitrage(_agentVault, address(this)) {} catch (bytes memory) {}
    }

    function withdrawToken(IERC20 token) external onlyOwner {
        SafeERC20.safeTransfer(token, owner(), token.balanceOf(address(this)));
    }

    function withderawNat() external onlyOwner {
        payable(owner()).transfer(address(this).balance);
    }

    //////////////////////////// only owner on liquidator methods ////////////////////////////

    function runArbitrage(address _agentVault, address _to) override public {
        require(address(msg.sender) == address(this), "calling an internal method");
        super.runArbitrage(_agentVault, _to);
    }

    function runArbitrageWithCustomParams(
        address _agentVault,
        IERC3156FlashLender _flashLender,
        IBlazeSwapRouter _blazeSwapRouter,
        address _to
    ) override public {
        require(address(msg.sender) == address(this), "calling an internal method");
        super.runArbitrageWithCustomParams(_agentVault, _flashLender, _blazeSwapRouter, _to);
    }
}