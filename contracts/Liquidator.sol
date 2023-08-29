// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./interface/IWNat.sol";
import "./interface/IAssetManager.sol";
import "./interface/IBlazeSwapRouter.sol";
import "./interface/IFAsset.sol";
import "./interface/IAgentVault.sol";


contract Liquidator {
    address payable owner;

    constructor() {
        owner = payable(msg.sender);
    }

    function executeArbitrage(
        IWNat _wNat,
        IFAsset _fAsset,
        IERC20 _vaultCollateral,
        IBlazeSwapRouter _vaultCollateralFAssetDex,
        IAssetManager _assetManager,
        IAgentVault agentVault
    ) external {
        // get wNat (preferably via flash loan)
        uint256 class1StartBalance = _vaultCollateral.balanceOf(address(this));
        // buy max f-assets possible with class1
        (, uint256[] memory obtainedFAsset) = 
            _vaultCollateralFAssetDex.swapExactTokensForTokens(
                class1StartBalance, 0, 
                _toDynamicArray(address(_vaultCollateral), address(_fAsset)), 
                address(this),
                block.timestamp
            );
        // liquidate obtained f-assets
        (, uint256 obtainedClass1, uint256 obtainedWNat) =
            _assetManager.liquidate(address(agentVault), obtainedFAsset[0]);
        // if obtained class1 already covers the starting class1, end
        uint256 class1EndBalance = _vaultCollateral.balanceOf(address(this));
        if (obtainedClass1 >= class1StartBalance) return;
        // else check if swapping obtained wnat to class1 is arbitrage
        _wNat.withdraw(obtainedWNat); 
        _vaultCollateralFAssetDex.swapExactNATForTokens{value: obtainedWNat}(
            0, 
            _toDynamicArray(address(_vaultCollateral), address(_wNat)), 
            address(this),
            block.timestamp
        );
        class1EndBalance = _vaultCollateral.balanceOf(address(this));
        require(class1EndBalance >= class1StartBalance, 
            "Arbitrage failed: class1 balance decreased");
    }

    function withdrawToken(IERC20 token) external {
        token.transfer(owner, token.balanceOf(address(this)));
    }

    function withderawNat() external {
        owner.transfer(address(this).balance);
    }
 
    function _toDynamicArray(address _x, address _y) internal pure returns (address[] memory) {
        address[] memory _arr = new address[](2);
        _arr[0] = _x;
        _arr[1] = _y;
        return _arr;
    }
}
