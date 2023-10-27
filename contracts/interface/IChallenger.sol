// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./ILiquidator.sol";

/**
 * @title ILiquidator
 * @notice An arbitrage does not need any sent funds,
 * send funds only if you wish to donate to the contract owner.
 */
interface IChallenger is ILiquidator {

    function illegalPaymentChallenge(
        ISCProofVerifier.BalanceDecreasingTransaction calldata _transaction,
        address _agentVault,
        address _assetManager
    ) external;

    function doublePaymentChallenge(
        ISCProofVerifier.BalanceDecreasingTransaction calldata _payment1,
        ISCProofVerifier.BalanceDecreasingTransaction calldata _payment2,
        address _agentVault,
        address _assetManager
    ) external;

    function freeBalanceNegativeChallenge(
        ISCProofVerifier.BalanceDecreasingTransaction[] calldata _payments,
        address _agentVault,
        address _assetManager
    ) external;

}