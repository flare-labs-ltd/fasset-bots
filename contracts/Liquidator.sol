// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "fasset/contracts/fasset/interface/IFAsset.sol";
import "fasset/contracts/userInterfaces/IAssetManager.sol";
import "./interface/ILiquidator.sol";
import "./lib/ArbitrageStrategy.sol";


// always assume pool = wrapped native
contract Liquidator is ILiquidator, Ownable {

    IWNat public immutable wNat; // wrapped native address is constant
    IERC3156FlashLender public flashLender;
    IBlazeSwapRouter public blazeswap;

    constructor(
        IWNat _wNat,
        IERC3156FlashLender _flashLender,
        IBlazeSwapRouter _blazeSwap
    ) Ownable() {
        wNat = _wNat;
        flashLender = _flashLender;
        blazeswap = _blazeSwap;
    }

    function runArbitrage(
        IIAgentVault _agentVault
    ) external {
        runArbitrageWithCustomParams(_agentVault, flashLender, blazeswap);
    }

    function runArbitrageWithCustomParams(
        IIAgentVault _agentVault,
        IERC3156FlashLender _flashLender,
        IBlazeSwapRouter _blazeSwap
    ) public {
        // extrapolate data
        IAssetManager assetManager = _agentVault.assetManager();
        AssetManagerSettings.Data memory assetManagerSettings = assetManager.getSettings();
        AgentInfo.Info memory agentInfo = assetManager.getAgentInfo(address(_agentVault));
        // send vault collateral to owner (so arbitrage fails in case of decreased funds)
        IERC20 vaultToken = agentInfo.vaultCollateralToken;
        vaultToken.transfer(owner(), vaultToken.balanceOf(address(this)));
        // get max and optimal vault collateral to flash loan
        uint256 maxVaultFlashLoan = flashLender.maxFlashLoan(address(vaultToken));
        uint256 optimalVaultAmount = ArbitrageStrategy.getOptimalVaultCollateral(
            address(wNat),
            agentInfo,
            assetManagerSettings,
            _blazeSwap
        );
        // run flash loan
        _flashLender.flashLoan(
            this,
            address(vaultToken),
            Math.min(optimalVaultAmount, maxVaultFlashLoan),
            abi.encode(
                assetManagerSettings.fAsset,
                assetManager,
                _agentVault,
                _blazeSwap
            )
        );
        // send earnings to sender
        vaultToken.transfer(msg.sender, vaultToken.balanceOf(address(this)));
    }

    function onFlashLoan(
        address /* _initiator */,
        address _token,
        uint256 _amount,
        uint256 _fee,
        bytes calldata _data
    ) external returns (bytes32) {
        (
            IFAsset _fAsset,
            IAssetManager _assetManager,
            IIAgentVault _agentVault,
            IBlazeSwapRouter _blazeSwap
        ) = abi.decode(_data, (
            IFAsset,
            IAssetManager,
            IIAgentVault,
            IBlazeSwapRouter
        ));
        _executeArbitrage(
            IERC20(_token),
            _fAsset,
            _assetManager,
            _agentVault,
            _blazeSwap,
            _amount
        );
        // approve flash loan spending to flash lender
        IERC20(_token).approve(address(msg.sender), _amount + _fee);
        return keccak256("ERC3156FlashBorrower.onFlashLoan");
    }

    function _executeArbitrage(
        IERC20 _vaultToken,
        IFAsset _fAsset,
        IAssetManager _assetManager,
        IAgentVault _agentVault,
        IBlazeSwapRouter _blazeSwap,
        uint256 _vaultAmount
    ) internal {
        // swap vault collateral for f-asset
        (, uint256[] memory obtainedFAsset) = _blazeSwap.swapExactTokensForTokens(
            _vaultAmount, 0,
            _toDynamicArray(address(_vaultToken), address(_fAsset)),
            address(this),
            block.timestamp
        );
        // liquidate obtained f-asset
        (,, uint256 obtainedPool) = _assetManager.liquidate(
            address(_agentVault),
            obtainedFAsset[0]
        );
        // swap pool for vault collateral
        _blazeSwap.swapExactTokensForTokens(
            obtainedPool, 0,
            _toDynamicArray(address(wNat), address(_vaultToken)),
            address(this),
            block.timestamp
        );
    }

    function withdrawToken(IERC20 token) external onlyOwner {
        token.transfer(owner(), token.balanceOf(address(this)));
    }

    function withderawNat() external onlyOwner {
        payable(owner()).transfer(address(this).balance);
    }

    function _toDynamicArray(
        address _x,
        address _y
    ) private pure returns (address[] memory) {
        address[] memory _arr = new address[](2);
        _arr[0] = _x;
        _arr[1] = _y;
        return _arr;
    }
}
