import { IERC20MetadataInstance } from "../../typechain-truffle";
import { IAssetAgentContext } from "../fasset-bots/IAssetBotContext";
import { CollateralClass, CollateralType } from "../fasset/AssetManagerTypes";
import { IBlockChainWallet } from "../underlying-chain/interfaces/IBlockChainWallet";
import { Currency } from "./Currency";
import { ERC20TokenBalance, EVMNativeTokenBalance, WalletTokenBalance } from "./TokenBalance";
import { artifacts } from "./web3";

const IERC20 = artifacts.require("IERC20Metadata");
const CollateralPool = artifacts.require("IICollateralPool");

export namespace TokenBalances {
    export async function evmNative(symbol: string) {
        return new EVMNativeTokenBalance(new Currency(symbol, 18));
    }

    export async function wallet(walletClient: IBlockChainWallet, currency: Currency) {
        return new WalletTokenBalance(walletClient, currency);
    }

    export async function erc20(token: IERC20MetadataInstance) {
        const symbol = await token.symbol();
        const decimals = Number(await token.decimals());
        return new ERC20TokenBalance(token, new Currency(symbol, decimals));
    }

    export async function collateralType(collateral: CollateralType) {
        const token = await IERC20.at(collateral.token);
        const symbol = await token.symbol().catch(() => collateral.tokenFtsoSymbol);
        const decimals = Number(collateral.decimals);
        return new ERC20TokenBalance(token, new Currency(symbol, decimals));
    }

    export async function fasset(context: IAssetAgentContext) {
        return TokenBalances.erc20(context.fAsset as IERC20MetadataInstance);
    }

    export async function fassetUnderlyingToken(context: IAssetAgentContext) {
        const symbol = await context.fAsset.assetSymbol();
        const decimals = Number(await context.fAsset.decimals());
        return new WalletTokenBalance(context.wallet, new Currency(symbol, decimals));
    }

    export async function agentVaultCollateral(context: IAssetAgentContext, agentVaultAddress: string) {
        const agentInfo = await context.assetManager.getAgentInfo(agentVaultAddress);
        const collateral = await context.assetManager.getCollateralType(CollateralClass.VAULT, agentInfo.vaultCollateralToken);
        return await TokenBalances.collateralType(collateral);
    }

    export async function agentPoolCollateral(context: IAssetAgentContext, agentVaultAddress: string) {
        const agentInfo = await context.assetManager.getAgentInfo(agentVaultAddress);
        const pool = await CollateralPool.at(agentInfo.collateralPool);
        const wnat = await IERC20.at(await pool.wNat());
        return TokenBalances.erc20(wnat);
    }

    export async function agentCollateralPoolToken(context: IAssetAgentContext, agentVaultAddress: string) {
        const agentInfo = await context.assetManager.getAgentInfo(agentVaultAddress);
        const pool = await CollateralPool.at(agentInfo.collateralPool);
        const poolToken = await IERC20.at(await pool.poolToken());
        return TokenBalances.erc20(poolToken);
    }
}

export namespace Currencies {
    export function evmNative(symbol: string) {
        return TokenBalances.evmNative(symbol).then(tb => tb.currency);
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
