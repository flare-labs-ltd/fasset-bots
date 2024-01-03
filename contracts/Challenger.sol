// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
import "./interface/IChallenger.sol";
import "./Liquidator.sol";

/**
 * @title Challenger
 * @notice Contract to challenge the asset manager
 * @notice all methods can be called by the owner only
 * @notice onFlashLoan will revert if not called through runArbitrage
 */
contract Challenger is IChallenger, Liquidator, Ownable {

    constructor(
        IERC3156FlashLender _flashLender,
        IBlazeSwapRouter _blazeSwap
    ) Liquidator(_flashLender, _blazeSwap) {}

    function illegalPaymentChallenge(
        BalanceDecreasingTransaction.Proof calldata _transaction,
        address _agentVault
    )
        public
        onlyOwner
    {
        IAssetManager assetManager = IIAgentVault(_agentVault).assetManager();
        assetManager.illegalPaymentChallenge(_transaction, _agentVault);
        // if liquidation fails, we don't want to revert the made challenge
        try this.runArbitrage(_agentVault, address(this)) {} catch (bytes memory) {}
    }

    function doublePaymentChallenge(
        BalanceDecreasingTransaction.Proof calldata _payment1,
        BalanceDecreasingTransaction.Proof calldata _payment2,
        address _agentVault
    )
        public
        onlyOwner
    {
        IAssetManager assetManager = IIAgentVault(_agentVault).assetManager();
        assetManager.doublePaymentChallenge( _payment1, _payment2, _agentVault);
        // if liquidation fails, we don't want to revert the made challenge
        try this.runArbitrage(_agentVault, address(this)) {} catch (bytes memory) {}
    }

    function freeBalanceNegativeChallenge(
        BalanceDecreasingTransaction.Proof[] calldata _payments,
        address _agentVault
    )
        public
        onlyOwner
    {
        IAssetManager assetManager = IIAgentVault(_agentVault).assetManager();
        assetManager.freeBalanceNegativeChallenge(_payments, _agentVault);
        // if liquidation fails, we don't want to revert the made challenge
        try this.runArbitrage(_agentVault, address(this)) {} catch (bytes memory) {}
    }

    function withdrawToken(
        IERC20 token
    )
        external
        onlyOwner
    {
        SafeERC20.safeTransfer(token, owner(), token.balanceOf(address(this)));
    }

    function withderawNat()
        external
        onlyOwner
    {
        payable(owner()).transfer(address(this).balance);
    }

    //////////////////////////// impose internal on liquidator methods ////////////////////////////

    function runArbitrage(
        address _agentVault,
        address _profitTo
    )
        public override
    {
        require(address(msg.sender) == address(this), "calling an internal method");
        super.runArbitrage(_agentVault, _profitTo);
    }

    function runArbitrageWithCustomParams(
        address _agentVault,
        address _profitTo,
        address _flashLender,
        address _dex,
        DexConfig memory _dexConfig
    )
        public
        override
    {
        require(address(msg.sender) == address(this), "calling an internal method");
        super.runArbitrageWithCustomParams(_agentVault, _profitTo, _flashLender, _dex, _dexConfig);
    }
}