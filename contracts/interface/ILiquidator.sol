// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/interfaces/IERC3156FlashLender.sol";
import "@openzeppelin/contracts/interfaces/IERC3156FlashBorrower.sol";
import "./IUniswapV2/IUniswapV2Router.sol";


/**
 * @title ILiquidator
 * @notice An arbitrage does not need funds to be sent.
 */
interface ILiquidator is IERC3156FlashBorrower {

    /**
     * Runs the arbitrage with the given parameters.
     * @param _agentVault The agent vault to liquidate from
     * @param _profitTo The address to send the profits to
     * @param _vaultToFAssetMinDexPriceMul The minimum price of the vault fAsset pair on the dex
     * @param _vaultToFAssetMinDexPriceDiv The minimum price of the vault fAsset pair on the dex
     * @param _poolToVaultMinDexPriceMul The minimum price at which to buy vault with wnat on the dex
     * @param _poolToVaultMinDexPriceDiv The minimum price of the pool vault pair on the dex
     * @param _flashLender The flash lender to use for the liquidation (if address(0), use default))
     * @param _dex UniswapV2 router contract to use for the liquidation (if address(0), use default))
     * @param _vaultToFAssetDexPath The path to swap from the vault to the fAsset (if [] use [vault, fAsset])
     * @param _poolToVaultDexPath The path to swap from the pool to the vault (if [] use [pool, vault])
     */
    function runArbitrage(
        address _agentVault,
        address _profitTo,
        uint256 _vaultToFAssetMinDexPriceMul,
        uint256 _vaultToFAssetMinDexPriceDiv,
        uint256 _poolToVaultMinDexPriceMul,
        uint256 _poolToVaultMinDexPriceDiv,
        IERC3156FlashLender _flashLender,
        IUniswapV2Router _dex,
        address[] memory _vaultToFAssetDexPath,
        address[] memory _poolToVaultDexPath
     ) external;
}