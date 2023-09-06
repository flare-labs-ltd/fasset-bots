// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "fasset/contracts/utils/lib/MathUtils.sol";
import "fasset/contracts/utils/lib/SafePct.sol";
import "fasset/contracts/userInterfaces/data/AgentInfo.sol";
import "fasset/contracts/userInterfaces/data/AssetManagerSettings.sol";
import "fasset/contracts/fasset/mock/FtsoMock.sol";
import "./LiquidationStrategyMock.sol";
import "./AgentMock.sol";
import "./AssetManagerMock.sol";


contract AssetManagerMock {
    using MathUtils for uint256;
    using SafePct for *;

    uint256 internal constant AMG_TOKEN_WEI_PRICE_SCALE_EXP = 9;
    uint256 internal constant AMG_TOKEN_WEI_PRICE_SCALE = 10 ** AMG_TOKEN_WEI_PRICE_SCALE_EXP;

    AssetManagerSettings.Data private settings;
    uint256 public minCollateralRatioBIPS;

    FtsoMock public vaultCollateralFtso;
    FtsoMock public poolCollateralFtso;
    FtsoMock public fAssetFtso;

    struct CRData {
        uint256 vaultCR;
        uint256 poolCR;
        uint256 amgToC1WeiPrice;
        uint256 amgToPoolWeiPrice;
    }

    constructor (
        address _liquidationStrategy, uint8 _assetMintingDecimals,
        uint256 _minCollateralRatioBIPS, uint64 _lotSizeAMG, uint64 _assetMintingGranularityUBA,
        FtsoMock _vaultCollateralFtso, FtsoMock _poolCollateralFtso, FtsoMock _fAssetFtso
    ) {
        settings.liquidationStrategy = _liquidationStrategy;
        settings.assetMintingDecimals = _assetMintingDecimals;
        settings.lotSizeAMG = _lotSizeAMG;
        settings.assetMintingGranularityUBA = _assetMintingGranularityUBA;
        minCollateralRatioBIPS = _minCollateralRatioBIPS;
        vaultCollateralFtso = _vaultCollateralFtso;
        poolCollateralFtso = _poolCollateralFtso;
        fAssetFtso = _fAssetFtso;
    }

    function liquidate(
        address _agentVault,
        uint256 _amountUBA
    )
        external
        returns (uint256 _liquidatedAmountUBA, uint256 _amountPaidVault, uint256 _amountPaidPool)
    {
        // check that agent is in liquidation
        return _liquidate(msg.sender, _agentVault, _amountUBA);
    }

    function getAgentInfo(
        address _agentVault
    )
        external view
        returns (AgentInfo.Info memory)
    {
        return AgentMock(_agentVault).getInfo();
    }

    function getSettings()
        external view
        returns (AssetManagerSettings.Data memory)
    {
        return settings;
    }

    function fAsset() public view returns (address) {
        return settings.fAsset;
    }

    ////////////////////////////////////////////////////////////////
    // remove this when agent info holds the below data

    function getMaxLiquidatedFAssetUBA(address _agentVault) external view returns (uint256) {
        AgentInfo.Info memory agentInfo = AgentMock(_agentVault).getInfo();
        CRData memory cr = _getCollateralRatiosBIPS(agentInfo);
        (uint256 vaultFactor, uint256 poolFactor) = LiquidationStrategyMock(settings.liquidationStrategy)
            .currentLiquidationFactorBIPS(address(0), cr.vaultCR, cr.poolCR);
        return convertAmgToUBA(Math.max(
            _maxLiquidationAmountAMG(agentInfo, cr.vaultCR, vaultFactor),
            _maxLiquidationAmountAMG(agentInfo, cr.poolCR, poolFactor)
        ));
    }

    function getLiquidationFactorVaultBips(address _agentVault) external view returns (uint256 vaultFactor) {
        AgentInfo.Info memory agentInfo = AgentMock(_agentVault).getInfo();
        CRData memory cr = _getCollateralRatiosBIPS(agentInfo);
        (vaultFactor,) = LiquidationStrategyMock(settings.liquidationStrategy)
            .currentLiquidationFactorBIPS(address(0), cr.vaultCR, cr.poolCR);
    }

    function getLiquidationFactorPoolBips(address _agentVault) external view returns (uint256 poolFactor) {
        AgentInfo.Info memory agentInfo = AgentMock(_agentVault).getInfo();
        CRData memory cr = _getCollateralRatiosBIPS(agentInfo);
        (,poolFactor) = LiquidationStrategyMock(settings.liquidationStrategy)
            .currentLiquidationFactorBIPS(address(0), cr.vaultCR, cr.poolCR);
    }
    
    ////////////////////////////////////////////////////////////////
    // liquidation

    function _liquidate(
        address _sender,
        address _agentVault,
        uint256 _amountUBA
    )
        internal
        returns (uint256 _liquidatedAmountUBA, uint256 _amountPaidVault, uint256 _amountPaidPool)
    {
        AgentMock agent = AgentMock(_agentVault);
        AgentInfo.Info memory agentInfo = agent.getInfo();
        CRData memory cr = _getCollateralRatiosBIPS(agentInfo);
        // liquidate redemption tickets
        (uint256 liquidatedAmountAMG, uint256 payoutC1Wei, uint256 payoutPoolWei) =
            _performLiquidation(agentInfo, cr, convertUBAToAmg(_amountUBA));
        _liquidatedAmountUBA = convertAmgToUBA(liquidatedAmountAMG);
        // pay the liquidator
        if (payoutC1Wei > 0) {
            _amountPaidVault = agent.payoutFromVault(_sender, payoutC1Wei);
        }
        if (payoutPoolWei > 0) {
            _amountPaidPool = agent.payoutFromPool(_sender, payoutPoolWei);
        }
        // burn liquidated fassets
        agent.redeem(_sender, _liquidatedAmountUBA);
    }

    function _performLiquidation(
        AgentInfo.Info memory _agentInfo,
        CRData memory _cr,
        uint256 _amountAMG
    )
        internal view
        returns (uint256 _liquidatedAMG, uint256 _payoutC1Wei, uint256 _payoutPoolWei)
    {
        // split liquidation payment between agent vault and pool
        (uint256 vaultFactor, uint256 poolFactor) = LiquidationStrategyMock(settings.liquidationStrategy)
            .currentLiquidationFactorBIPS(address(0), _cr.vaultCR, _cr.poolCR);
        // calculate liquidation amount
        uint256 maxLiquidatedAMG = Math.max(
            _maxLiquidationAmountAMG(_agentInfo, _cr.vaultCR, vaultFactor),
            _maxLiquidationAmountAMG(_agentInfo, _cr.poolCR, poolFactor));
        uint256 amountToLiquidateAMG = Math.min(maxLiquidatedAMG, _amountAMG);
        _liquidatedAMG = Math.min(amountToLiquidateAMG, convertUBAToAmg(_agentInfo.mintedUBA));
        // calculate payouts to liquidator
        _payoutC1Wei = convertAmgToTokenWei(_liquidatedAMG.mulBips(vaultFactor), _cr.amgToC1WeiPrice);
        _payoutPoolWei = convertAmgToTokenWei(_liquidatedAMG.mulBips(poolFactor), _cr.amgToPoolWeiPrice);
    }

    function _getCollateralRatiosBIPS(
        AgentInfo.Info memory _agentInfo
    )
        internal view
        returns (CRData memory)
    {   
        (uint256 vaultCR, uint256 amgToC1WeiPrice) = _getCollateralRatioBIPS(_agentInfo, false);
        (uint256 poolCR, uint256 amgToPoolWeiPrice) = _getCollateralRatioBIPS(_agentInfo, true);
        return CRData({
            vaultCR: vaultCR,
            poolCR: poolCR,
            amgToC1WeiPrice: amgToC1WeiPrice,
            amgToPoolWeiPrice: amgToPoolWeiPrice
        });
    }

     function _getCollateralRatioBIPS(
        AgentInfo.Info memory _agentInfo,
        bool _pool
    )
        private view
        returns (uint256, uint256)
    {
        // assume both collaterals are erc20 tokens with 18 decimals
        uint256 redeemingUBA;
        uint256 collateralWei;
        uint256 ubaToWeiPrice;
        (uint256 assetPrice,, uint256 assetFtsoDec) = fAssetFtso.getCurrentPriceWithDecimals();
        if (_pool) {
            redeemingUBA = _agentInfo.poolRedeemingUBA;
            collateralWei = _agentInfo.totalPoolCollateralNATWei;
            (uint256 tokenPrice,, uint256 tokenFtsoDec) = poolCollateralFtso.getCurrentPriceWithDecimals();
            ubaToWeiPrice = calcAmgToTokenWeiPrice(18, tokenPrice, tokenFtsoDec, assetPrice, assetFtsoDec);
        } else {
            redeemingUBA = _agentInfo.redeemingUBA;
            collateralWei = _agentInfo.totalVaultCollateralWei;
            (uint256 tokenPrice,, uint256 tokenFtsoDec) = vaultCollateralFtso.getCurrentPriceWithDecimals();
            ubaToWeiPrice = calcAmgToTokenWeiPrice(18, tokenPrice, tokenFtsoDec, assetPrice, assetFtsoDec);
        }
        uint256 totalUBA = uint256(_agentInfo.mintedUBA) + uint256(redeemingUBA);
        if (totalUBA == 0) return (1e10, ubaToWeiPrice); // nothing minted - ~infinite collateral ratio (but avoid overflows)
        uint256 backingTokenWei = convertAmgToTokenWei(totalUBA, ubaToWeiPrice);
        return (collateralWei.mulDiv(SafePct.MAX_BIPS, backingTokenWei), ubaToWeiPrice);
    }

    function _maxLiquidationAmountAMG(
        AgentInfo.Info memory _agentInfo,
        uint256 _collateralRatioBIPS,
        uint256 _factorBIPS
    )
        private view
        returns (uint256)
    {
        // otherwise, liquidate just enough to get agent to safety
        uint256 targetRatioBIPS = minCollateralRatioBIPS;
        if (targetRatioBIPS <= _collateralRatioBIPS) {
            return 0;               // agent already safe
        }
        if (_collateralRatioBIPS <= _factorBIPS) {
            return _agentInfo.mintedUBA; // cannot achieve target - liquidate all
        }
        uint256 maxLiquidatedAMG = convertUBAToAmg(_agentInfo.mintedUBA)
            .mulDivRoundUp(targetRatioBIPS - _collateralRatioBIPS, targetRatioBIPS - _factorBIPS);
        // round up to whole number of lots
        maxLiquidatedAMG = maxLiquidatedAMG.roundUp(settings.lotSizeAMG);
        return Math.min(maxLiquidatedAMG, _agentInfo.mintedUBA);
    }

    function convertUBAToAmg(uint256 _valueUBA) internal view returns (uint256) {
        return _valueUBA / settings.assetMintingGranularityUBA;
    }

    function convertAmgToUBA(uint256 _valueAMG) internal view returns (uint256) {
        return _valueAMG * settings.assetMintingGranularityUBA;
    }

    function convertAmgToTokenWei(uint256 _valueAMG, uint256 _amgToTokenWeiPrice) internal pure returns (uint256) {
        return _valueAMG.mulDiv(_amgToTokenWeiPrice, AMG_TOKEN_WEI_PRICE_SCALE);
    }

    function calcAmgToTokenWeiPrice(
        uint256 _tokenDecimals,
        uint256 _tokenPrice,
        uint256 _tokenFtsoDecimals,
        uint256 _assetPrice,
        uint256 _assetFtsoDecimals
    )
        internal view
        returns (uint256)
    {
        uint256 expPlus = _tokenDecimals + _tokenFtsoDecimals + AMG_TOKEN_WEI_PRICE_SCALE_EXP;
        uint256 expMinus = settings.assetMintingDecimals + _assetFtsoDecimals;
        // If negative, price would probably always be 0 after division, so this is forbidden.
        // Anyway, we should know about this before we add the token and/or asset, since
        // token decimals and ftso decimals typically never change.
        assert(expPlus >= expMinus);
        return _assetPrice.mulDiv(10 ** (expPlus - expMinus), _tokenPrice);
    }
}
