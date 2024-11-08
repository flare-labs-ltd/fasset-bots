// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { Math } from "@openzeppelin/contracts/utils/math/Math.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { IERC20Metadata } from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import { IAssetManager, IIAssetManager, AssetManagerSettings } from "@flarelabs/fasset/contracts/assetManager/interfaces/IIAssetManager.sol";
import { IIAgentVault } from "@flarelabs/fasset/contracts/assetManager/interfaces/IIAgentVault.sol";
import { IPriceReader } from "@flarelabs/fasset/contracts/assetManager/interfaces/IPriceReader.sol";
import { AgentInfo } from "@flarelabs/fasset/contracts/userInterfaces/data/AgentInfo.sol";
import { CollateralType } from "@flarelabs/fasset/contracts/userInterfaces/data/CollateralType.sol";
import { UniswapV2 } from './UniswapV2.sol';
import { EcosystemData, PoolReserves } from "./Structs.sol";
import { AMG_TOKEN_WEI_PRICE_SCALE_EXP } from "./Constants.sol";


library Ecosystem {
    using UniswapV2 for address;

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
        // addresses
        _data.assetManager = address(assetManager);
        _data.agentVault = _agentVault;
        // tokens
        _data.fAssetToken = address(assetManager.fAsset());
        _data.poolCT = address(assetManager.getWNat());
        // asset manager settings
        _data.assetMintingGranularityUBA = assetManager.assetMintingGranularityUBA();
        _data.assetMintingDecimals = assetManager.assetMintingDecimals();
        // agent data
        _data.vaultCT = address(assetManager.getAgentVaultCollateralToken(address(_agentVault)));
        ( _data.liquidationFactorVaultBips, _data.liquidationFactorPoolBips, _data.maxLiquidatedFAssetUBA)
            = assetManager.getAgentLiquidationFactorsAndMaxAmount(address(_agentVault));
        // ftso prices
        (_data.priceFAssetAmgVaultCT, _data.priceFAssetAmgPoolCT)
            = _getPrices(_data, IPriceReader(assetManager.priceReader()));
    }

    function getDexReserves(
        address _dex,
        address[] memory _path
    )
        internal view
        returns (PoolReserves[] memory _reserves)
    {
        _reserves = new PoolReserves[](_path.length - 1);
        for (uint256 i = 0; i < _path.length - 1; i++) {
            (_reserves[i].reserveA, _reserves[i].reserveB) =
                _dex.getReserves(_path[i], _path[i + 1]);
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
