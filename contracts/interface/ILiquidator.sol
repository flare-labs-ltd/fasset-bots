// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/interfaces/IERC3156FlashBorrower.sol";
import "blazeswap/contracts/periphery/interfaces/IBlazeSwapRouter.sol";

/**
 * @title DexConfig
 * @notice Configuration of a dex to use for the liquidation
 */
struct DexConfig {
    address[] vaultToFAssetPath;
    address[] poolToVaultPath;
    uint256 maxSlippageBips;
}

/**
 * @title ILiquidator
 * @notice An arbitrage does not need any sent funds,
 * send funds only if you wish to donate to the contract owner.
 */
interface ILiquidator is IERC3156FlashBorrower {

    /**
     * Runs the arbitrage with default flash lender service and blaze swap router defined at construction
     * @param _agentVault The agent vault to liquidate from
     * @param _profitTo The address to send the profits to
     */
    function runArbitrage(
        address _agentVault,
        address _profitTo
    ) external;

    /**
     * Runs the arbitrage with custom flash lender service and blaze swap router
     * @param _profitTo The address to send the profits to
     * @param _agentVault The agent vault to liquidate from
     * @param _flashLender The flash lender to use for the liquidation (if address(0), use default))
     * @param _dex The dex to use for the liquidation (if address(0), use default))
     * @param _dexConfig The configuration of the dex to use for the liquidation
     */
    function runArbitrageWithCustomParams(
        address _agentVault,
        address _profitTo,
        address _flashLender,
        address _dex,
        DexConfig memory _dexConfig
     ) external;
}