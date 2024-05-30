import { IERC20MetadataInstance, IICollateralPoolInstance } from "../../typechain-truffle";
import { IAssetAgentContext, IAssetNativeChainContext } from "../fasset-bots/IAssetBotContext";
import { CollateralClass, CollateralType } from "../fasset/AssetManagerTypes";
import { IBlockChainWallet } from "../underlying-chain/interfaces/IBlockChainWallet";
import { ERC20TokenBalance, EVMNativeTokenBalance, WalletTokenBalance } from "./TokenBalance";
import { artifacts } from "./web3";

const IERC20 = artifacts.require("IERC20Metadata");
const CollateralPool = artifacts.require("IICollateralPool");

export namespace TokenBalances {
    export async function evmNative(context: IAssetNativeChainContext) {
        return new EVMNativeTokenBalance(context.nativeChainInfo.tokenSymbol, 18);
    }

    export async function wallet(walletClient: IBlockChainWallet, symbol: string, decimals: number) {
        return new WalletTokenBalance(walletClient, symbol, decimals);
    }

    export async function erc20(token: IERC20MetadataInstance) {
        const symbol = await token.symbol();
        const decimals = Number(await token.decimals());
        return new ERC20TokenBalance(token, symbol, decimals);
    }

    export async function collateralType(collateral: CollateralType) {
        const token = await IERC20.at(collateral.token);
        const symbol = await token.symbol().catch(() => collateral.tokenFtsoSymbol);
        const decimals = Number(collateral.decimals);
        return new ERC20TokenBalance(token, symbol, decimals);
    }

    export async function fasset(context: IAssetNativeChainContext) {
        return TokenBalances.erc20(context.fAsset as IERC20MetadataInstance);
    }

    export async function fassetUnderlyingToken(context: IAssetAgentContext) {
        const symbol = await context.fAsset.assetSymbol();
        const decimals = Number(await context.fAsset.decimals());
        return new WalletTokenBalance(context.wallet, symbol, decimals);
    }

    export async function agentVaultCollateral(context: IAssetAgentContext, agentVaultAddress: string) {
        const agentInfo = await context.assetManager.getAgentInfo(agentVaultAddress);
        const collateral = await context.assetManager.getCollateralType(CollateralClass.VAULT, agentInfo.vaultCollateralToken);
        return await TokenBalances.collateralType(collateral);
    }

    export async function agentPoolCollateral(context: IAssetAgentContext, agentVaultAddress: string) {
        const agentInfo = await context.assetManager.getAgentInfo(agentVaultAddress);
        return await poolCollateral(agentInfo.collateralPool);
    }

    export async function agentCollateralPoolToken(context: IAssetAgentContext, agentVaultAddress: string) {
        const agentInfo = await context.assetManager.getAgentInfo(agentVaultAddress);
        return await collateralPoolToken(agentInfo.collateralPool);
    }

    export async function poolCollateral(collateralPool: IICollateralPoolInstance | string) {
        const pool = typeof collateralPool === "string" ? await CollateralPool.at(collateralPool) : collateralPool;
        const wnat = await IERC20.at(await pool.wNat());
        return TokenBalances.erc20(wnat);
    }

    export async function collateralPoolToken(collateralPool: IICollateralPoolInstance | string) {
        const pool = typeof collateralPool === "string" ? await CollateralPool.at(collateralPool) : collateralPool;
        const poolToken = await IERC20.at(await pool.poolToken());
        return TokenBalances.erc20(poolToken);
    }
}
