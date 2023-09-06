// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

import "@openzeppelin/contracts/interfaces/IERC20.sol";
import "fasset/contracts/userInterfaces/data/AgentInfo.sol";
import "./ERC20Mock.sol";

contract AgentMock {
    AgentInfo.Info private info;
    ERC20Mock public fAssetToken;
    ERC20Mock public vaultCollateralToken;
    ERC20Mock public poolCollateralToken;

    constructor(
        ERC20Mock _vaultCollateralToken, 
        ERC20Mock _poolCollateralToken, 
        ERC20Mock _fAssetToken
    ) {
        info.vaultCollateralToken = IERC20(_vaultCollateralToken);
        poolCollateralToken = _poolCollateralToken;
        fAssetToken = _fAssetToken;
    }

    function mint(address _target, uint256 _amountUBA) external {
        info.mintedUBA += _amountUBA;
        fAssetToken.mint(_target, _amountUBA);
    }

    function redeem(address _target, uint256 _amountUBA) external {
        info.mintedUBA -= _amountUBA;
        fAssetToken.burn(_target, _amountUBA);
    }

    function depositVaultCollateral(uint256 _amount) external {
        info.totalVaultCollateralWei += _amount;
        vaultCollateralToken.mint(address(this), _amount);
    }

    function depositPoolCollateral(uint256 _amount) external {
        info.totalPoolCollateralNATWei += _amount;
        poolCollateralToken.mint(address(this), _amount);
    }

    function payoutFromVault(address _target, uint256 _amount) external returns (uint256) {
        info.totalVaultCollateralWei -= _amount;
        uint256 balance = vaultCollateralToken.balanceOf(address(this));
        if (balance < _amount) _amount = balance;
        vaultCollateralToken.transfer(_target, _amount);
        return _amount;
    }

    function payoutFromPool(address _target, uint256 _amount) external returns (uint256) {
        info.totalPoolCollateralNATWei -= _amount;
        uint256 balance = poolCollateralToken.balanceOf(address(this));
        if (balance < _amount) _amount = balance;
        poolCollateralToken.transfer(_target, _amount);
        return _amount;
    }

    function setRedeemingCollateral(uint256 _amountUBA, bool pool) external {
        if (!pool) info.redeemingUBA = _amountUBA;
        else info.poolRedeemingUBA = _amountUBA;
    }

    function getInfo() external view returns (AgentInfo.Info memory) {
        return info;
    }

}