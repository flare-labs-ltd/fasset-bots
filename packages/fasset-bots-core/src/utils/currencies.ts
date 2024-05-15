import { IERC20MetadataInstance } from "../../typechain-truffle";
import { IAssetAgentContext, IAssetNativeChainContext } from "../fasset-bots/IAssetBotContext";
import { CollateralType } from "../fasset/AssetManagerTypes";
import { ChainInfo } from "../fasset/ChainInfo";
import { Currency } from "./Currency";
import { TokenBalances } from "./token-balances";


export namespace Currencies {
    export function chain(chainInfo: ChainInfo) {
        return new Currency(chainInfo.symbol, chainInfo.decimals);
    }

    export function evmNative(context: IAssetNativeChainContext) {
        return TokenBalances.evmNative(context);
    }

    export function erc20(token: IERC20MetadataInstance) {
        return TokenBalances.erc20(token);
    }

    export function collateralType(collateral: CollateralType) {
        return TokenBalances.collateralType(collateral);
    }

    export function fasset(context: IAssetAgentContext) {
        return TokenBalances.fasset(context);
    }

    export function fassetUnderlyingToken(context: IAssetAgentContext) {
        return TokenBalances.fassetUnderlyingToken(context);
    }

    export function agentVaultCollateral(context: IAssetAgentContext, agentVaultAddress: string) {
        return TokenBalances.agentVaultCollateral(context, agentVaultAddress);
    }

    export function agentPoolCollateral(context: IAssetAgentContext, agentVaultAddress: string) {
        return TokenBalances.agentPoolCollateral(context, agentVaultAddress);
    }

    export function agentCollateralPoolToken(context: IAssetAgentContext, agentVaultAddress: string) {
        return TokenBalances.agentCollateralPoolToken(context, agentVaultAddress);
    }
}
