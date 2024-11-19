// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {SafeERC20, IERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IIAgentVault, IIAssetManager, IAssetManager} from "@flarelabs/fasset/contracts/assetManager/interfaces/IIAgentVault.sol";
import {BalanceDecreasingTransaction} from "@flarelabs/fasset/contracts/stateConnector/interfaces/ISCProofVerifier.sol";
import {IChallenger} from "./interfaces/IChallenger.sol";
import {ILiquidator} from "./interfaces/ILiquidator.sol";
import {ArbitrageConfig} from "./lib/Structs.sol";
import {Liquidator} from "./Liquidator.sol";

/**
 * @title Challenger
 * @notice Contract to challenge the asset manager
 * @notice all methods can be called by the owner only
 * @notice onFlashLoan will revert if not called through runArbitrage
 */
contract Challenger is IChallenger, Liquidator {

    constructor(
        address _flashLender,
        address _dex
    ) Liquidator(_flashLender, _dex) {}

    function illegalPaymentChallenge(
        BalanceDecreasingTransaction.Proof calldata _transaction,
        address _agentVault,
        address _profitTo,
        ArbitrageConfig calldata _config
    )
        public
        onlyOwner
    {
        IAssetManager assetManager = IIAgentVault(_agentVault).assetManager();
        assetManager.illegalPaymentChallenge(_transaction, _agentVault);
        // if liquidation fails, we don't want to revert the made challenge
        try this.runArbitrage(_agentVault, _profitTo, _config) {} catch (bytes memory) {}
    }

    function doublePaymentChallenge(
        BalanceDecreasingTransaction.Proof calldata _payment1,
        BalanceDecreasingTransaction.Proof calldata _payment2,
        address _agentVault,
        address _profitTo,
        ArbitrageConfig calldata _config
    )
        public
        onlyOwner
    {
        IAssetManager assetManager = IIAgentVault(_agentVault).assetManager();
        assetManager.doublePaymentChallenge( _payment1, _payment2, _agentVault);
        // if liquidation fails, we don't want to revert the made challenge
        try this.runArbitrage(_agentVault, _profitTo, _config) {} catch (bytes memory) {}

    }

    function freeBalanceNegativeChallenge(
        BalanceDecreasingTransaction.Proof[] calldata _payments,
        address _agentVault,
        address _profitTo,
        ArbitrageConfig calldata _config
    )
        public
        onlyOwner
    {
        IAssetManager assetManager = IIAgentVault(_agentVault).assetManager();
        assetManager.freeBalanceNegativeChallenge(_payments, _agentVault);
        // if liquidation fails, we don't want to revert the made challenge
        try this.runArbitrage(_agentVault, _profitTo, _config) {} catch (bytes memory) {}
    }

    function runArbitrage(
        address _agentVault,
        address _profitTo,
        ArbitrageConfig memory _config
    )
        public override(Liquidator, ILiquidator)
    {
        require(msg.sender == address(this), "Challenger: Calling an internal method");
        _runArbitrage(_agentVault, _profitTo, _config);
    }
}
