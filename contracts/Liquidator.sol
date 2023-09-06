// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "fasset/contracts/fasset/interface/IFAsset.sol";
import "fasset/contracts/userInterfaces/IAssetManager.sol";
import "fasset/contracts/fasset/interface/IPriceReader.sol";
import "blazeswap/contracts/shared/libraries/Babylonian.sol";
import "./interface/ILiquidator.sol";

// remove this when liquidation data is included in AgentInfo
import "./mock/AssetManagerMock.sol";


// for now assume that flash loans do not have fees
struct ArbitrageData {
    // tokens
    address vaultToken;
    address fAssetToken;
    address poolToken;
    // agent
    uint256 agentVaultCollateralWei;
    uint256 agentPoolCollateralWei;
    // asset manager liquidation
    uint256 maxLiquidatedFAssetUBA;
    uint256 liquidationFactorVaultBips;
    uint256 liquidationFactorPoolBips;
    // dexes
    uint256 feeBipsDex1;
    uint256 feeBipsDex2;
    uint256 reserveVaultWeiDex1;
    uint256 reserveFAssetUBADex1;
    uint256 reservePoolWeiDex2;
    uint256 reserveVaultWeiDex2;
    // prices
    uint256 priceFAssetVaultMul;
    uint256 priceFAssetVaultDiv;
    uint256 priceFAssetPoolMul;
    uint256 priceFAssetPoolDiv;
}

// always assume pool = wrapped native
contract Liquidator is ILiquidator, Ownable {
    using Babylonian for uint256;

    IWNat public immutable wNat; // wrapped native address is constant
    IFlashLender public flashLender;
    IBlazeSwapRouter public blazeswap;

    constructor(
        IWNat _wNat,
        IFlashLender _flashLender, 
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
        IFlashLender _flashLender,
        IBlazeSwapRouter _blazeSwap
    ) public {
        // extrapolate data
        IAssetManager assetManager = _agentVault.assetManager();
        AssetManagerSettings.Data memory assetManagerSettings = assetManager.getSettings();
        AgentInfo.Info memory agentInfo = assetManager.getAgentInfo(address(_agentVault));
        // get arbitrage data and optimal vault collateral
        ArbitrageData memory arbitrageData = _getArbitrageData(
            agentInfo, assetManagerSettings, _blazeSwap, /* _flashLender, */
            AssetManagerMock(address(assetManager)), address(_agentVault)
        );
        uint256 vaultAmount = Math.min(
            _getOptimalArbitrageVaultCollateral(arbitrageData), 
            flashLender.maxFlashLoan()
        );
        // run flash loan and revert if arbitrage failed
        // arbitrage decreased balance only if contract held vault before the call
        IERC20 vaultToken = IERC20(agentInfo.vaultCollateralToken);
        uint256 startVaultBalance = vaultToken.balanceOf(address(this));
        _flashLender.flashLoan(this, vaultAmount, abi.encode(
            wNat,
            vaultToken,
            assetManagerSettings.fAsset,
            assetManager,
            _agentVault,
            _blazeSwap
        ));
        uint256 endVaultBalance = vaultToken.balanceOf(address(this));
        require(endVaultBalance > startVaultBalance, 
            "Arbitrage failed: vault collateral balance decreased");
        // send earnings to sender (keep any funds held within the contract)
        uint256 earnings = endVaultBalance - startVaultBalance;
        IERC20(agentInfo.vaultCollateralToken).transfer(msg.sender, earnings);
    }

    function onFlashLoan(
        address /* _initiator */,
        address /* _token */,
        uint256 _amount,
        uint256 _fee,
        bytes calldata _data
    ) external returns (bytes32) {
        (
            IWNat _wNat,
            IERC20 _vaultToken,
            IFAsset _fAsset,
            IAssetManager _assetManager,
            IIAgentVault _agentVault, 
            IBlazeSwapRouter _blazeSwap
        ) = abi.decode(_data, (
            IWNat,
            IERC20,
            IFAsset,
            IAssetManager,
            IIAgentVault, 
            IBlazeSwapRouter
        ));
        _executeArbitrage(
            _wNat,
            _vaultToken,
            _fAsset,
            _assetManager,
            _agentVault,
            _blazeSwap,
            _amount
        );
        // approve flash loan spending to flash lender
        _vaultToken.approve(address(msg.sender), _amount + _fee);
        return keccak256("ERC3156FlashBorrower.onFlashLoan");
    }

    function _executeArbitrage(
        IWNat _wNat,
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
            _toDynamicArray(address(_wNat), address(_vaultToken)), 
            address(this), 
            block.timestamp
        );
    }

    function _getOptimalArbitrageVaultCollateral(
        ArbitrageData memory _arbitrageData
    ) internal pure returns (uint256) {
        uint256 factorBipsDex1 = 10_000 - _arbitrageData.feeBipsDex1;
        uint256 factorBipsDex2 = 10_000 - _arbitrageData.feeBipsDex2;
        uint256 _aux1 = _arbitrageData.reservePoolWeiDex2
            // * _arbitrageData.flashLoanFeeBips
            * factorBipsDex1 ** 2 // TODO: handle overflows
            / 10_000 ** 2;
        require(_aux1 > 0, "Arbitrage failed: dex2 reserve of pool wei is zero");
        uint256 _aux2 = _arbitrageData.reserveVaultWeiDex1
            * _arbitrageData.reservePoolWeiDex2
            // * _arbitrageData.flashLoanFeeBips
            * factorBipsDex1
            / 10_000;
        uint256 _aux3 = _arbitrageData.reserveFAssetUBADex1
            * _arbitrageData.priceFAssetVaultMul
            * _arbitrageData.liquidationFactorVaultBips
            * _arbitrageData.reserveVaultWeiDex1
            * _arbitrageData.reservePoolWeiDex2 ** 2 // TODO: handle overflows
            // * _arbitrageData.flashLoanFeeBips
            * factorBipsDex1 ** 3 // TODO: handle overflows
            / _arbitrageData.priceFAssetVaultDiv
            / 10_000 ** 3;
        uint256 _aux4 = _arbitrageData.reserveFAssetUBADex1
            * _arbitrageData.priceFAssetPoolMul
            * _arbitrageData.liquidationFactorPoolBips
            * _arbitrageData.reserveVaultWeiDex1
            * _arbitrageData.reserveVaultWeiDex2
            * _arbitrageData.reservePoolWeiDex2
            // * _arbitrageData.flashLoanFeeBips
            * factorBipsDex1 ** 3 // TODO: handle overflows
            * factorBipsDex2
            / _arbitrageData.priceFAssetPoolDiv
            / 10_000 ** 3;
        uint256 _aux5 = (_aux3 + _aux4).sqrt();
        require(_aux5 > _aux2, "Arbitrage failed: negative investment");
        return (_aux5 - _aux2) / _aux1;
    }

    function _getArbitrageData(
        AgentInfo.Info memory _agentInfo,
        AssetManagerSettings.Data memory _assetManagerSettings,
        IBlazeSwapRouter _blazeSwap,
        /* IFlashLender _flashLender */
        AssetManagerMock _assetManager, // remove when liquidation data is included in AgentInfo
        address _agentVault // remove when liquidation data is included in AgentInfo
    ) internal view returns (ArbitrageData memory _arbitrageData) {
        // tokens
        _arbitrageData.vaultToken = address(_agentInfo.vaultCollateralToken);
        _arbitrageData.fAssetToken = address(_assetManagerSettings.fAsset);
        _arbitrageData.poolToken = address(wNat);
        // agent
        _arbitrageData.agentVaultCollateralWei = _agentInfo.totalVaultCollateralWei;
        _arbitrageData.agentPoolCollateralWei = _agentInfo.totalPoolCollateralNATWei;
        // asset manager liquidation (fix this when liquidation data is included in AgentInfo)
        _arbitrageData.maxLiquidatedFAssetUBA = _assetManager.getMaxLiquidatedFAssetUBA(_agentVault);
        _arbitrageData.liquidationFactorVaultBips = _assetManager.getLiquidationFactorVaultBips(_agentVault);
        _arbitrageData.liquidationFactorPoolBips = _assetManager.getLiquidationFactorPoolBips(_agentVault);
        // dexes
        _arbitrageData.feeBipsDex1 = 3000; // blazeswap hardcodes 0.3% fee like uniswap-v2
        _arbitrageData.feeBipsDex2 = 3000; // blazeswap hardcodes 0.3% fee like uniswap-v2
        (_arbitrageData.reserveVaultWeiDex1, _arbitrageData.reserveFAssetUBADex1) = _blazeSwap.getReserves(
            _arbitrageData.vaultToken, _arbitrageData.fAssetToken
        );
        (_arbitrageData.reservePoolWeiDex2, _arbitrageData.reserveVaultWeiDex2) = _blazeSwap.getReserves(
            _arbitrageData.poolToken, _arbitrageData.vaultToken
        );
        // prices
        string memory fAssetSymbol = IERC20Metadata(_arbitrageData.fAssetToken).symbol();
        uint8 fAssetDecimals = IERC20Metadata(_arbitrageData.fAssetToken).decimals();
        (_arbitrageData.priceFAssetVaultMul, _arbitrageData.priceFAssetVaultDiv) = _getToken1Token2PriceMulDiv(
            IPriceReader(_assetManagerSettings.priceReader),
            fAssetSymbol, fAssetDecimals,
            IERC20Metadata(_arbitrageData.vaultToken).symbol(),
            IERC20Metadata(_arbitrageData.vaultToken).decimals()
        );
        (_arbitrageData.priceFAssetPoolMul, _arbitrageData.priceFAssetPoolDiv) = _getToken1Token2PriceMulDiv(
            IPriceReader(_assetManagerSettings.priceReader),
            fAssetSymbol, fAssetDecimals,
            IERC20Metadata(_arbitrageData.poolToken).symbol(),
            IERC20Metadata(_arbitrageData.poolToken).decimals()
        );
    }

    function _getToken1Token2PriceMulDiv(
        IPriceReader _priceReader,
        string memory _symbol1,
        uint256 _decimals1,
        string memory _symbol2,
        uint256 _decimals2
    ) internal view returns (uint256, uint256) {
        (uint256 price1,, uint256 ftsoDecimals1) = _priceReader.getPrice(_symbol1);
        (uint256 price2,, uint256 ftsoDecimals2) = _priceReader.getPrice(_symbol2);
        return (
            price1 * (10 ** (_decimals2 + ftsoDecimals2)),  
            price2 * (10 ** (_decimals1 + ftsoDecimals1))
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
