// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "fasset/contracts/generated/interface/ISCProofVerifier.sol";
import "./Liquidator.sol";

contract Challenger is Liquidator {

    constructor(
        IWNat _wNat,
        IERC3156FlashLender _flashLender,
        IBlazeSwapRouter _blazeSwap
    ) Liquidator(_wNat, _flashLender, _blazeSwap) {}

    function illegalPaymentChallenge(
        ISCProofVerifier.BalanceDecreasingTransaction calldata _transaction,
        address _agentVault
    ) external {
        Ecosystem.Data memory data = getData(_agentVault);
        IAssetManager(data.assetManager).illegalPaymentChallenge(_transaction, _agentVault);
        // if liquidation fails, we don't want to revert the made challenge
        try this.runArbitrageWithData(data) {} catch {}
    }

    function doublePaymentChallenge(
        ISCProofVerifier.BalanceDecreasingTransaction calldata _payment1,
        ISCProofVerifier.BalanceDecreasingTransaction calldata _payment2,
        address _agentVault
    ) external {
        Ecosystem.Data memory data = getData(_agentVault);
        IAssetManager(data.assetManager).doublePaymentChallenge( _payment1, _payment2, _agentVault);
        // if liquidation fails, we don't want to revert the made challenge
        try this.runArbitrageWithData(data) {} catch {}
    }

    function freeBalanceNegativeChallenge(
        ISCProofVerifier.BalanceDecreasingTransaction[] calldata _payments,
        address _agentVault
    ) external {
        Ecosystem.Data memory data = getData(_agentVault);
        IAssetManager(data.assetManager).freeBalanceNegativeChallenge(_payments, _agentVault);
        // if liquidation fails, we don't want to revert the made challenge
        try this.runArbitrageWithData(data) {} catch {}
    }

    // make it external (may be a slight security concern)
    function runArbitrageWithData(Ecosystem.Data memory _data) external {
        _runArbitrageWithData(_data);
    }

    function getData(address _agentVault) internal view returns (Ecosystem.Data memory) {
        return Ecosystem.getData(_agentVault, address(blazeSwap), address(flashLender));
    }
}