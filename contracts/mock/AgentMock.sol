// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

import "@openzeppelin/contracts/interfaces/IERC20.sol";
import "fasset/contracts/userInterfaces/data/AgentInfo.sol";
import "./ERC20Mock.sol";
import "./AssetManagerMock.sol";


contract AgentMock {
    AgentInfo.Info private info;
    AssetManagerMock public assetManager;
    ERC20Mock public fAssetToken;
    ERC20Mock public vaultCollateralToken;
    ERC20Mock public poolCollateralToken;

    constructor(
        AssetManagerMock _assetManager,
        ERC20Mock _vaultCollateralToken
    ) {
        assetManager = _assetManager;
        vaultCollateralToken = _vaultCollateralToken;
        poolCollateralToken = ERC20Mock(_assetManager.getWNat());
        fAssetToken = ERC20Mock(_assetManager.fAsset());
        // store vault collateral token in info
        info.vaultCollateralToken = IERC20(_vaultCollateralToken);
    }

    modifier onlyAssetManager() {
        require(msg.sender == address(assetManager), "only asset manager");
        _;
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

    function payoutFromVault(
        address _target,
        uint256 _amount
    ) external onlyAssetManager returns (uint256) {
        info.totalVaultCollateralWei -= _amount;
        vaultCollateralToken.transfer(_target, _amount);
        return _amount;
    }

    function payoutFromPool(
        address _target,
        uint256 _amount
    ) external onlyAssetManager returns (uint256) {
        info.totalPoolCollateralNATWei -= _amount;
        poolCollateralToken.transfer(_target, _amount);
        return _amount;
    }

    function putInFullLiquidation() external onlyAssetManager {
        info.status = AgentInfo.Status.FULL_LIQUIDATION;
    }

    function getInfo()
        external view onlyAssetManager
        returns (AgentInfo.Info memory)
    {
        return info;
    }

}