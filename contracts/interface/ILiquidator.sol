// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/interfaces/IERC3156FlashBorrower.sol";
import "blazeswap/contracts/periphery/interfaces/IBlazeSwapRouter.sol";
import "@openzeppelin/contracts/interfaces/IERC3156FlashLender.sol";


/**
 * @title ILiquidator
 * @notice An arbitrage does not need any sent funds,
 * send funds only if you wish to donate to the contract owner.
 */
interface ILiquidator is IERC3156FlashBorrower {

    /**
     * Runs the arbitrage with default flash lender service and blaze swap router defined at construction
     * @param _agentVault The agent vault to liquidate from
     */
    function runArbitrage(
        address _agentVault
    ) external;

    /**
     * Runs the arbitrage with custom flash lender service and blaze swap router
     * @param _agentVault The agent vault to liquidate from
     * @param _flashLender The flash lender to use for the liquidation (if address(0), use default))
     * @param _blazeswap The BlazeSwap router to use for the liquidation (if address(0), use default))
     *
     */
    function runArbitrageWithCustomParams(
        address _agentVault,
        IERC3156FlashLender _flashLender,
        IBlazeSwapRouter _blazeswap
    ) external;
}