// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/interfaces/IERC3156FlashBorrower.sol";

/**
 * @title ILiquidator
 * @notice An arbitrage does not need funds to be sent.
 */
interface ILiquidator is IERC3156FlashBorrower {

    /**
     * Runs the arbitrage with the given parameters.
     * @param _agentVault The agent vault to liquidate from
     * @param _profitTo The address to send the profits to
     * @param _flashLender The flash lender to use for the liquidation (if address(0), use default))
     * @param _dexRouter UniswapV2 dex router to use for the liquidation (if address(0), use default))
     * @param _vaultToFAssetMinDexPriceMul The minimum price of the vault fAsset pair on the dex
     * @param _vaultToFAssetMinDexPriceDiv The minimum price of the vault fAsset pair on the dex
     * @param _poolToVaultMinDexPriceMul The minimum price at which to buy vault with wnat on the dex
     * @param _poolToVaultMinDexPriceDiv The minimum price of the pool vault pair on the dex
     * @param _vaultToFAssetDexPath The path to swap from the vault to the fAsset (if [] use [vault, fAsset])
     * @param _poolToVaultDexPath The path to swap from the pool to the vault (if [] use [pool, vault])
     */
    function runArbitrage(
        address _agentVault,
        address _profitTo,
        address _flashLender,
        address _dexRouter,
        uint256 _vaultToFAssetMinDexPriceMul,
        uint256 _vaultToFAssetMinDexPriceDiv,
        uint256 _poolToVaultMinDexPriceMul,
        uint256 _poolToVaultMinDexPriceDiv,
        address[] memory _vaultToFAssetDexPath,
        address[] memory _poolToVaultDexPath
     ) external;
}