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
        return TokenBalances.evmNative(context).then(tb => tb.currency);
    }

    export function erc20(token: IERC20MetadataInstance) {
        return TokenBalances.erc20(token).then(tb => tb.currency);
    }

    export function collateralType(collateral: CollateralType) {
        return TokenBalances.collateralType(collateral).then(tb => tb.currency);
    }

    export function fasset(context: IAssetAgentContext) {
        return TokenBalances.fasset(context).then(tb => tb.currency);
    }

    export function fassetUnderlyingToken(context: IAssetAgentContext) {
        return TokenBalances.fassetUnderlyingToken(context).then(tb => tb.currency);
    }

    export function agentVaultCollateral(context: IAssetAgentContext, agentVaultAddress: string) {
        return TokenBalances.agentVaultCollateral(context, agentVaultAddress).then(tb => tb.currency);
    }

    export function agentPoolCollateral(context: IAssetAgentContext, agentVaultAddress: string) {
        return TokenBalances.agentPoolCollateral(context, agentVaultAddress).then(tb => tb.currency);
    }

    export function agentCollateralPoolToken(context: IAssetAgentContext, agentVaultAddress: string) {
        return TokenBalances.agentCollateralPoolToken(context, agentVaultAddress).then(tb => tb.currency);
    }
}
