// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "fasset/contracts/stateConnector/interface/ISCProofVerifier.sol";
import "./ILiquidator.sol";

/**
 * @title ILiquidator
 * @notice An arbitrage does not need any sent funds,
 * send funds only if you wish to donate to the contract owner.
 */
interface IChallenger is ILiquidator {

    function illegalPaymentChallenge(
        BalanceDecreasingTransaction.Proof calldata _transaction,
        address _agentVault
    ) external;

    function doublePaymentChallenge(
        BalanceDecreasingTransaction.Proof calldata _payment1,
        BalanceDecreasingTransaction.Proof calldata _payment2,
        address _agentVault
    ) external;

    function freeBalanceNegativeChallenge(
        BalanceDecreasingTransaction.Proof[] calldata _payments,
        address _agentVault
    ) external;

}