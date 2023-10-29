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
    ) external virtual onlyOwner {
        Ecosystem.Data memory data = getData(_agentVault);
        IAssetManager(data.assetManager).illegalPaymentChallenge(_transaction, _agentVault);
        // if liquidation fails, we don't want to revert the made challenge
        try this.runArbitrageWithData(data) {} catch {}
    }

    function doublePaymentChallenge(
        BalanceDecreasingTransaction.Proof calldata _payment1,
        BalanceDecreasingTransaction.Proof calldata _payment2,
        address _agentVault
    ) external virtual onlyOwner {
        Ecosystem.Data memory data = getData(_agentVault);
        IAssetManager(data.assetManager).doublePaymentChallenge( _payment1, _payment2, _agentVault);
        // if liquidation fails, we don't want to revert the made challenge
        try this.runArbitrageWithData(data) {} catch {}
    }

    function freeBalanceNegativeChallenge(
        BalanceDecreasingTransaction.Proof[] calldata _payments,
        address _agentVault
    ) external virtual onlyOwner {
        Ecosystem.Data memory data = getData(_agentVault);
        IAssetManager(data.assetManager).freeBalanceNegativeChallenge(_payments, _agentVault);
        // if liquidation fails, we don't want to revert the made challenge
        try this.runArbitrageWithData(data) {} catch {}
    }

    // make it external (may be a slight security concern)
    function runArbitrageWithData(Ecosystem.Data memory _data) external {
        require(msg.sender == address(this), "practically internal");
        _runArbitrageWithData(_data);
    }

    function getData(address _agentVault) internal view returns (Ecosystem.Data memory) {
        return Ecosystem.getData(_agentVault, address(blazeSwapRouter), address(flashLender));
    }
}