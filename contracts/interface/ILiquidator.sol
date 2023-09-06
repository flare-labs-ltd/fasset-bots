// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/interfaces/IERC3156FlashBorrower.sol";
import "blazeswap/contracts/periphery/interfaces/IBlazeSwapRouter.sol";
import "fasset/contracts/fasset/interface/IIAgentVault.sol";
import "./IFlashLender.sol";


/**
 * @title ILiquidator
 * @notice Never send funds to this contract, only gas fees are required for an arbitrage!
 */
interface ILiquidator is IERC3156FlashBorrower {

    /**
     * Runs the arbitrage with default flash lender service and blaze swap router defined at construction
     * @param _agentVault The agent vault to liquidate from
     */
    function runArbitrage(
        IIAgentVault _agentVault
    ) external;

    /**
     * Runs the arbitrage with custom flash lender service and blaze swap router
     * @param _agentVault The agent vault to liquidate from
     * @param _flashLender The flash lender to use for the liquidation (if address(0), use default))
     * @param _blazeswap The BlazeSwap router to use for the liquidation (if address(0), use default))
     * 
     */
    function runArbitrageWithCustomParams(
        IIAgentVault _agentVault,
        IFlashLender _flashLender,
        IBlazeSwapRouter _blazeswap
    ) external;
    
}