// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC3156FlashBorrower} from "@openzeppelin/contracts/interfaces/IERC3156FlashBorrower.sol";
import {ArbitrageConfig} from "../lib/Structs.sol";


/**
 * @title ILiquidator
 * @notice An arbitrage does not need funds to be sent.
 */
interface ILiquidator is IERC3156FlashBorrower {

    /**
     * Runs the arbitrage with the given parameters.
     * @param _agentVault The agent vault to be liquidated,
     * @param _profitTo The address to which the profit should be sent
     * @param _config The arbitrage configuration
     */
    function runArbitrage(
        address _agentVault,
        address _profitTo,
        ArbitrageConfig memory _config
     ) external;

    /**
     * Returns the minimum prices of relevant dexes from the given maximum slippage.
     * @param _maxSlippageBipsDex1 The maximum slippage for the vault / f-asset dex
     * @param _maxSlippageBipsDex2 The maximum slippage for the pool / vault dex
     * @param _agentVault The agent vault from which to deduce vault, pool, and f-asset tokens
     **/
    function maxSlippageToMinPrices(
        uint256 _maxSlippageBipsDex1,
        uint256 _maxSlippageBipsDex2,
        address _agentVault
    ) external view returns (uint256, uint256, uint256, uint256);

    /**
     * Withdraws the given ERC-20 token from the contract.
     * @param token The token to withdraw
     */
    function withdrawToken(
        IERC20 token
    )
        external;

    /**
     * Withdraws the native token from the contract.
     */
    function withdrawNat()
        external;
}