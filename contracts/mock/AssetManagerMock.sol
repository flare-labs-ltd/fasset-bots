// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/utils/math/Math.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "fasset/contracts/utils/lib/MathUtils.sol";
import "fasset/contracts/utils/lib/SafePct.sol";
import "fasset/contracts/fasset/mock/FakePriceReader.sol";
import "fasset/contracts/userInterfaces/data/AgentInfo.sol";
import "fasset/contracts/userInterfaces/data/AssetManagerSettings.sol";
import "fasset/contracts/fasset/library/CollateralTypes.sol";
import "./AgentMock.sol";
import "./AssetManagerMock.sol";


contract AssetManagerMock {
    using MathUtils for uint256;
    using SafePct for *;

    uint256 internal constant AMG_TOKEN_WEI_PRICE_SCALE_EXP = 9;
    uint256 internal constant AMG_TOKEN_WEI_PRICE_SCALE = 10 ** AMG_TOKEN_WEI_PRICE_SCALE_EXP;

    address public wNat;
    uint256 public minVaultCollateralRatioBIPS;
    uint256 public minPoolCollateralRatioBIPS;

    string internal assetFtsoSymbol;
    string internal vaultFtsoSymbol;
    string internal poolFtsoSymbol;

    AssetManagerSettings.Data private settings;

    struct CRData {
        uint256 vaultCR;
        uint256 poolCR;
        uint256 amgToC1WeiPrice;
        uint256 amgToPoolWeiPrice;
    }

    constructor (
        address _wNat,
        address _fAsset,
        FakePriceReader _priceReader,
        uint64 _lotSizeAMG,
        uint8 _assetMintingDecimals,
        uint256 _minVaultCollateralRatioBIPS,
        uint256 _minPoolCollateralRatioBIPS,
        // ftso symbols
        string memory _assetSymbol,
        string memory _vaultSymbol,
        string memory _poolSymbol
    ) {
        uint8 assetDecimals = IERC20Metadata(_fAsset).decimals();
        // settings
        settings.priceReader = address(_priceReader);
        settings.fAsset = _fAsset;
        settings.lotSizeAMG = _lotSizeAMG;
        settings.assetMintingDecimals = _assetMintingDecimals;
        settings.assetMintingGranularityUBA = uint64(10) ** (assetDecimals - _assetMintingDecimals);
        // local mock
        wNat = _wNat;
        minVaultCollateralRatioBIPS = _minVaultCollateralRatioBIPS;
        minPoolCollateralRatioBIPS = _minPoolCollateralRatioBIPS;
        // ftso symbols
        assetFtsoSymbol = _assetSymbol;
        vaultFtsoSymbol = _vaultSymbol;
        poolFtsoSymbol = _poolSymbol;
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
        AgentInfo.Info memory agentInfo = AgentMock(_agentVault).getInfo();
        CRData memory cr = _getCollateralRatiosBIPS(agentInfo);
        agentInfo.vaultCollateralRatioBIPS = cr.vaultCR;
        agentInfo.poolCollateralRatioBIPS = cr.poolCR;
        (
            agentInfo.liquidationPaymentFactorVaultBIPS,
            agentInfo.liquidationPaymentFactorPoolBIPS
        ) = _currentLiquidationFactorBIPS(address(0), cr.vaultCR, cr.poolCR);
        agentInfo.maxLiquidationAmountUBA = convertAmgToUBA(Math.max(
            _maxLiquidationAmountAMG(
                agentInfo,
                cr.vaultCR,
                agentInfo.liquidationPaymentFactorVaultBIPS,
                minVaultCollateralRatioBIPS
            ),
            _maxLiquidationAmountAMG(
                agentInfo,
                cr.poolCR,
                agentInfo.liquidationPaymentFactorPoolBIPS,
                minPoolCollateralRatioBIPS
            )
        ));
        return agentInfo;
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

    function getWNat() external view returns (address) {
        return wNat;
    }

    function getCollateralType(
        CollateralType.Class /* _class */,
        IERC20 _token
    ) external view returns (CollateralType.Data memory _collateralData) {
        _collateralData.assetFtsoSymbol = assetFtsoSymbol;
        if (address(_token) == wNat) {
            _collateralData.tokenFtsoSymbol = poolFtsoSymbol;
        } else {
            _collateralData.tokenFtsoSymbol = vaultFtsoSymbol;
        }
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
        (uint256 vaultFactor, uint256 poolFactor) =
            _currentLiquidationFactorBIPS(address(0), _cr.vaultCR, _cr.poolCR);
        // calculate liquidation amount
        uint256 maxLiquidatedAMG = Math.max(
            _maxLiquidationAmountAMG(_agentInfo, _cr.vaultCR, vaultFactor, minVaultCollateralRatioBIPS),
            _maxLiquidationAmountAMG(_agentInfo, _cr.poolCR, poolFactor, minPoolCollateralRatioBIPS));
        uint256 amountToLiquidateAMG = Math.min(maxLiquidatedAMG, _amountAMG);
        _liquidatedAMG = Math.min(amountToLiquidateAMG, convertUBAToAmg(_agentInfo.mintedUBA));
        // calculate payouts to liquidator
        _payoutC1Wei = convertAmgToTokenWei(_liquidatedAMG.mulBips(vaultFactor), _cr.amgToC1WeiPrice);
        _payoutPoolWei = convertAmgToTokenWei(_liquidatedAMG.mulBips(poolFactor), _cr.amgToPoolWeiPrice);
    }

    function _maxLiquidationAmountAMG(
        AgentInfo.Info memory _agentInfo,
        uint256 _collateralRatioBIPS,
        uint256 _factorBIPS,
        uint256 _targetRatioBIPS
    )
        private view
        returns (uint256)
    {
        if (_targetRatioBIPS <= _collateralRatioBIPS) {
            return 0;               // agent already safe
        }
        uint256 agentMintedAMG = convertUBAToAmg(_agentInfo.mintedUBA);
        if (_collateralRatioBIPS <= _factorBIPS) {
            return agentMintedAMG; // cannot achieve target - liquidate all
        }
        uint256 maxLiquidatedAMG = agentMintedAMG.mulDivRoundUp(
            _targetRatioBIPS - _collateralRatioBIPS,
            _targetRatioBIPS - _factorBIPS
        );
        // round up to whole number of lots
        maxLiquidatedAMG = maxLiquidatedAMG.roundUp(settings.lotSizeAMG);
        return Math.min(maxLiquidatedAMG, agentMintedAMG);
    }

    function _getCollateralRatiosBIPS(
        AgentInfo.Info memory _agentInfo
    )
        internal view
        returns (CRData memory)
    {
        (uint256 vaultCR, uint256 amgToC1WeiPrice) =
            _getCollateralRatioBIPS(_agentInfo, false);
        (uint256 poolCR, uint256 amgToPoolWeiPrice) =
            _getCollateralRatioBIPS(_agentInfo, true);
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
        IERC20Metadata _fAsset = IERC20Metadata(settings.fAsset);
        IERC20Metadata token;
        uint256 redeemingAMG;
        uint256 collateralWei;
        if (_pool) {
            token = IERC20Metadata(wNat);
            redeemingAMG = convertUBAToAmg(_agentInfo.poolRedeemingUBA);
            collateralWei = _agentInfo.totalPoolCollateralNATWei;
        } else {
            token = IERC20Metadata(address(_agentInfo.vaultCollateralToken));
            redeemingAMG = convertUBAToAmg(_agentInfo.redeemingUBA);
            collateralWei = _agentInfo.totalVaultCollateralWei;
        }
        (uint256 assetPrice,, uint256 assetFtsoDecimals) =
            IPriceReader(settings.priceReader).getPrice(_fAsset.symbol());
        (uint256 tokenPrice,, uint256 tokenFtsoDecimals) =
            IPriceReader(settings.priceReader).getPrice(token.symbol());
        uint256 amgToTokenWeiPrice = calcAmgToTokenWeiPrice(
            token.decimals(),
            tokenPrice,
            tokenFtsoDecimals,
            assetPrice,
            assetFtsoDecimals
        );
        uint256 totalAMG = uint256(convertUBAToAmg(_agentInfo.mintedUBA)) + uint256(redeemingAMG);
        if (totalAMG == 0) return (1e10, amgToTokenWeiPrice); // nothing minted
        uint256 backingTokenWei = convertAmgToTokenWei(totalAMG, amgToTokenWeiPrice);
        return (collateralWei.mulDiv(SafePct.MAX_BIPS, backingTokenWei), amgToTokenWeiPrice);
    }

    ////////////////////////////////////////////////////////////////
    // conversions

    function convertUBAToAmg(
        uint256 _valueUBA
    ) internal view returns (uint256) {
        return _valueUBA / settings.assetMintingGranularityUBA;
    }

    function convertAmgToUBA(
        uint256 _valueAMG
    ) internal view returns (uint256) {
        return _valueAMG * settings.assetMintingGranularityUBA;
    }

    function convertAmgToTokenWei(
        uint256 _valueAMG,
        uint256 _amgToTokenWeiPrice
    ) internal pure returns (uint256) {
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

    ////////////////////////////////////////////////////////////////
    // liquidation strategy

    uint256 public liquidationCollateralFactorBIPS;
    uint256 public liquidationFactorVaultCollateralBIPS;

    function _currentLiquidationFactorBIPS(
        address /* _agentVault */,
        uint256 _vaultCR,
        uint256 _poolCR
    )
        internal view
        returns (uint256 _c1FactorBIPS, uint256 _poolFactorBIPS)
    {
        uint256 factorBIPS = liquidationCollateralFactorBIPS;
        _c1FactorBIPS = Math.min(liquidationFactorVaultCollateralBIPS, factorBIPS);
        // never exceed CR of tokens
        if (_c1FactorBIPS > _vaultCR) {
            _c1FactorBIPS = _vaultCR;
        }
        _poolFactorBIPS = factorBIPS - _c1FactorBIPS;
        if (_poolFactorBIPS > _poolCR) {
            _poolFactorBIPS = _poolCR;
            _c1FactorBIPS = Math.min(factorBIPS - _poolFactorBIPS, _vaultCR);
        }
    }

    function setLiquidationFactors(
        uint256 _liquidationCollateralFactorBIPS,
        uint256 _liquidationFactorVaultCollateralBIPS
    ) external {
        liquidationCollateralFactorBIPS = _liquidationCollateralFactorBIPS;
        liquidationFactorVaultCollateralBIPS = _liquidationFactorVaultCollateralBIPS;
    }
}
