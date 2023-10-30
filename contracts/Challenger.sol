// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./interface/IChallenger.sol";
import "./Liquidator.sol";

contract Challenger is IChallenger, Liquidator {

    constructor(
        IERC3156FlashLender _flashLender,
        IBlazeSwapRouter _blazeSwap
    ) Liquidator(_flashLender, _blazeSwap) {}

    function illegalPaymentChallenge(
        BalanceDecreasingTransaction.Proof calldata _transaction,
        address _agentVault
    ) public virtual {
        IAssetManager assetManager = IIAgentVault(_agentVault).assetManager();
        assetManager.illegalPaymentChallenge(_transaction, _agentVault);
        // if liquidation fails, we don't want to revert the made challenge
        try this.runArbitrage(IIAgentVault(_agentVault)) {} catch (bytes memory) {}
    }

    function doublePaymentChallenge(
        BalanceDecreasingTransaction.Proof calldata _payment1,
        BalanceDecreasingTransaction.Proof calldata _payment2,
        address _agentVault
    ) public virtual {
        IAssetManager assetManager = IIAgentVault(_agentVault).assetManager();
        assetManager.doublePaymentChallenge( _payment1, _payment2, _agentVault);
        // if liquidation fails, we don't want to revert the made challenge
        try this.runArbitrage(IIAgentVault(_agentVault)) {} catch (bytes memory) {}
    }

    function freeBalanceNegativeChallenge(
        BalanceDecreasingTransaction.Proof[] calldata _payments,
        address _agentVault
    ) public virtual {
        IAssetManager assetManager = IIAgentVault(_agentVault).assetManager();
        assetManager.freeBalanceNegativeChallenge(_payments, _agentVault);
        // if liquidation fails, we don't want to revert the made challenge
        try this.runArbitrage(IIAgentVault(_agentVault)) {} catch (bytes memory) {}
    }
}

contract ChallengerOwned is Challenger {

    constructor(
        IERC3156FlashLender _flashLender,
        IBlazeSwapRouter _blazeSwap
    ) Challenger(_flashLender, _blazeSwap) {}

    function illegalPaymentChallenge(
        BalanceDecreasingTransaction.Proof calldata _transaction,
        address _agentVault
    ) public override onlyOwner {
        super.illegalPaymentChallenge(_transaction, _agentVault);
    }

    function doublePaymentChallenge(
        BalanceDecreasingTransaction.Proof calldata _payment1,
        BalanceDecreasingTransaction.Proof calldata _payment2,
        address _agentVault
    ) public override onlyOwner {
        super.doublePaymentChallenge(_payment1, _payment2, _agentVault);
    }

    function freeBalanceNegativeChallenge(
        BalanceDecreasingTransaction.Proof[] calldata _payments,
        address _agentVault
    ) public override onlyOwner {
        super.freeBalanceNegativeChallenge(_payments, _agentVault);
    }
}