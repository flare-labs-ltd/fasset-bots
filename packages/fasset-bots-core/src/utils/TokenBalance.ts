import BN from "bn.js";
import { IERC20MetadataInstance } from "../../typechain-truffle";
import { IAssetAgentContext } from "../fasset-bots/IAssetBotContext";
import { CollateralClass, CollateralType } from "../fasset/AssetManagerTypes";
import { IBlockChainWallet } from "../underlying-chain/interfaces/IBlockChainWallet";
import { Currency } from "./Currency";
import { FormatSettings } from "./formatting";
import { toBN } from "./helpers";
import { artifacts, web3 } from "./web3";

const IERC20 = artifacts.require("IERC20Metadata");
const CollateralPool = artifacts.require("IICollateralPool");

export abstract class TokenBalance {
    constructor(
        public currency: Currency
    ) {}

    abstract balance(address: string): Promise<BN>;

    async formatBalance(address: string, format?: FormatSettings) {
        const balance = await this.balance(address);
        return this.currency.format(balance, format);
    }

    // factory methods

    static async evmNative(symbol: string) {
        return new EVMNativeTokenBalance(new Currency(symbol, 18));
    }

    static async wallet(walletClient: IBlockChainWallet, currency: Currency) {
        return new WalletTokenBalance(walletClient, currency);
    }

    static async erc20(token: IERC20MetadataInstance) {
        const symbol = await token.symbol();
        const decimals = Number(await token.decimals());
        return new ERC20TokenBalance(token, new Currency(symbol, decimals));
    }

    static async collateralType(collateral: CollateralType) {
        const token = await IERC20.at(collateral.token);
        const symbol = await token.symbol().catch(() => collateral.tokenFtsoSymbol);
        const decimals = Number(collateral.decimals);
        return new ERC20TokenBalance(token, new Currency(symbol, decimals));
    }

    static async fasset(context: IAssetAgentContext) {
        return TokenBalance.erc20(context.fAsset as IERC20MetadataInstance);
    }

    static async fassetUnderlyingToken(context: IAssetAgentContext) {
        const symbol = await context.fAsset.assetSymbol();
        const decimals = Number(await context.fAsset.decimals());
        return new WalletTokenBalance(context.wallet, new Currency(symbol, decimals));
    }

    static async agentVaultCollateral(context: IAssetAgentContext, agentVaultAddress: string) {
        const agentInfo = await context.assetManager.getAgentInfo(agentVaultAddress);
        const collateral = await context.assetManager.getCollateralType(CollateralClass.VAULT, agentInfo.vaultCollateralToken);
        return await TokenBalance.collateralType(collateral);
    }

    static async agentPoolCollateral(context: IAssetAgentContext, agentVaultAddress: string) {
        const agentInfo = await context.assetManager.getAgentInfo(agentVaultAddress);
        const pool = await CollateralPool.at(agentInfo.collateralPool);
        const wnat = await IERC20.at(await pool.wNat());
        return TokenBalance.erc20(wnat);
    }

    static async agentCollateralPoolToken(context: IAssetAgentContext, agentVaultAddress: string) {
        const agentInfo = await context.assetManager.getAgentInfo(agentVaultAddress);
        const pool = await CollateralPool.at(agentInfo.collateralPool);
        const poolToken = await IERC20.at(await pool.poolToken());
        return TokenBalance.erc20(poolToken);
    }
}

export class EVMNativeTokenBalance extends TokenBalance {
    async balance(address: string) {
        return toBN(await web3.eth.getBalance(address));
    }
}

export class WalletTokenBalance extends TokenBalance {
    constructor(
        public wallet: IBlockChainWallet,
        currency: Currency,
    ) {
        super(currency);
    }

    balance(address: string) {
        return this.wallet.getBalance(address);
    }
}

export class ERC20TokenBalance extends TokenBalance {
    constructor(
        public token: IERC20MetadataInstance,
        currency: Currency,
    ) {
        super(currency);
    }

    balance(address: string) {
        return this.token.balanceOf(address);
    }
}
