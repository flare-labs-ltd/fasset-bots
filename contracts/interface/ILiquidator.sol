// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./IWNat.sol";
import "./IAssetManager.sol";
import "./IBlazeSwapRouter.sol";
import "./IFAsset.sol";
import "./IAgentVault.sol";

interface ILiquidator {

    function executeArbitrage(
        uint256 _vaultCollateralAmount,
        IWNat _wNat,
        IFAsset _fAsset,
        IERC20 _vaultCollateral,
        IBlazeSwapRouter _vaultCollateralFAssetDex,
        IAssetManager _assetManager,
        IAgentVault agentVault
    ) external;
    
}