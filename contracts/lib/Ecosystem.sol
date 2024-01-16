// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

import "@openzeppelin/contracts/utils/math/Math.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "blazeswap/contracts/periphery/interfaces/IBlazeSwapRouter.sol";
import "fasset/contracts/fasset/interface/IIAssetManager.sol";
import "fasset/contracts/fasset/interface/IIAgentVault.sol";
import "fasset/contracts/fasset/interface/IPriceReader.sol";
import "fasset/contracts/userInterfaces/data/AgentInfo.sol";
import "fasset/contracts/userInterfaces/data/CollateralType.sol";
import "./Structs.sol";
import "./Constants.sol";


library Ecosystem {

    // ftso symbols
    struct FtsoSymbols {
        string asset;
        string vault;
        string pool;
    }

    // note: this doesn't include the dex reserves
    function getFAssetData(
        address _agentVault
    ) internal view returns (EcosystemData memory _data) {
        // extrapolate data
        IIAssetManager assetManager = IIAgentVault(_agentVault).assetManager();
        AgentInfo.Info memory agentInfo = assetManager.getAgentInfo(address(_agentVault));
        AssetManagerSettings.Data memory settings = assetManager.getSettings();
        // addresses
        _data.assetManager = address(assetManager);
        _data.agentVault = _agentVault;
        // tokens
        _data.fAssetToken = settings.fAsset;
        _data.vaultCT = address(agentInfo.vaultCollateralToken);
        _data.poolCT = address(assetManager.getWNat());
        // agent
        _data.agentVaultCollateralWei = agentInfo.totalVaultCollateralWei;
        _data.agentPoolCollateralWei = agentInfo.totalPoolCollateralNATWei;
        _data.maxLiquidatedFAssetUBA = agentInfo.maxLiquidationAmountUBA;
        _data.liquidationFactorVaultBips = agentInfo.liquidationPaymentFactorVaultBIPS;
        _data.liquidationFactorPoolBips = agentInfo.liquidationPaymentFactorPoolBIPS;
        _data.assetMintingGranularityUBA = settings.assetMintingGranularityUBA;
        _data.assetMintingDecimals = settings.assetMintingDecimals;
        // ftso prices
        (_data.priceFAssetAmgVaultCT, _data.priceFAssetAmgPoolCT)
            = _getPrices(_data, IPriceReader(settings.priceReader));
    }

    function getDexReserves(
        address _dexRouter,
        address[] memory _path
    )
        internal view
        returns (PoolReserves[] memory _reserves)
    {
        _reserves = new PoolReserves[](_path.length - 1);
        for (uint256 i = 0; i < _path.length - 1; i++) {
            (_reserves[i].reserveA, _reserves[i].reserveB) =
                IBlazeSwapRouter(_dexRouter).getReserves(
                    _path[i], _path[i + 1]
                );
        }
    }

    function _getPrices(
        EcosystemData memory _data,
        IPriceReader _priceReader
    )
        private view
        returns (
            uint256 priceFAssetAmgVaultCT,
            uint256 priceFAssetAmgPoolCT
        )
    {
        FtsoSymbols memory symbols = _getFtsoSymbols(
            IAssetManager(_data.assetManager),
            IERC20(_data.vaultCT),
            IERC20(_data.poolCT)
        );
        (uint256 fAssetFtsoPrice,, uint256 fAssetFtsoDecimals)
            = _priceReader.getPrice(symbols.asset);
        (uint256 vaultFtsoPrice,, uint256 vaultFtsoDecimals)
            = _priceReader.getPrice(symbols.vault);
        (uint256 poolFtsoPrice,, uint256 poolFtsoDecimals)
            = _priceReader.getPrice(symbols.pool);
        return (
            _calcAmgToTokenPrice(
                IERC20Metadata(_data.vaultCT).decimals(),
                vaultFtsoPrice,
                vaultFtsoDecimals,
                _data.assetMintingDecimals,
                fAssetFtsoPrice,
                fAssetFtsoDecimals
            ),
            _calcAmgToTokenPrice(
                IERC20Metadata(_data.poolCT).decimals(),
                poolFtsoPrice,
                poolFtsoDecimals,
                _data.assetMintingDecimals,
                fAssetFtsoPrice,
                fAssetFtsoDecimals
            )
        );
    }

    function _getFtsoSymbols(
        IAssetManager _assetManager,
        IERC20 _vaultToken,
        IERC20 _poolToken
    )
        private view
        returns (FtsoSymbols memory _ftsoSymbols)
    {
        CollateralType.Data memory vaultData = _assetManager.getCollateralType(
            CollateralType.Class.VAULT, _vaultToken
        );
        CollateralType.Data memory poolData = _assetManager.getCollateralType(
            CollateralType.Class.POOL, _poolToken
        );
        _ftsoSymbols.asset = vaultData.assetFtsoSymbol;
        _ftsoSymbols.vault = vaultData.tokenFtsoSymbol;
        _ftsoSymbols.pool = poolData.tokenFtsoSymbol;
    }

    function _calcAmgToTokenPrice(
        uint256 _tokenDecimals,
        uint256 _tokenFtsoPrice,
        uint256 _tokenFtsoDecimals,
        uint256 _assetMintingDecimals,
        uint256 _assetFtsoPrice,
        uint256 _assetFtsoDecimals
    )
        private pure
        returns (uint256)
    {
        uint256 expPlus = _tokenDecimals + _tokenFtsoDecimals + AMG_TOKEN_WEI_PRICE_SCALE_EXP;
        uint256 expMinus = _assetMintingDecimals + _assetFtsoDecimals;
        // If negative, price would probably always be 0 after division, so this is forbidden.
        // Anyway, we should know about this before we add the token and/or asset, since
        // token decimals and ftso decimals typically never change.
        assert(expPlus >= expMinus);
        return _assetFtsoPrice * (10 ** (expPlus - expMinus)) / _tokenFtsoPrice;
    }
}