// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {BalanceDecreasingTransaction} from "@flarelabs/fasset/contracts/stateConnector/interfaces/ISCProofVerifier.sol";
import {ArbitrageConfig} from "../lib/Structs.sol";
import {ILiquidator} from "./ILiquidator.sol";


interface IChallenger is ILiquidator {

    function illegalPaymentChallenge(
        BalanceDecreasingTransaction.Proof calldata _transaction,
        address _agentVault,
        address _profitTo,
        ArbitrageConfig memory _config
    ) external;

    function doublePaymentChallenge(
        BalanceDecreasingTransaction.Proof calldata _payment1,
        BalanceDecreasingTransaction.Proof calldata _payment2,
        address _agentVault,
        address _profitTo,
        ArbitrageConfig memory _config
    ) external;

    function freeBalanceNegativeChallenge(
        BalanceDecreasingTransaction.Proof[] calldata _payments,
        address _agentVault,
        address _profitTo,
        ArbitrageConfig memory _config
    ) external;

}
