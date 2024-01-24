import { IAssetAgentBotContext } from "../fasset-bots/IAssetBotContext";
import { CollateralClass, CollateralType } from "../fasset/AssetManagerTypes";
import { FormatSettings, formatFixed } from "./formatting";
import { BNish, toBN, toBNExp } from "./helpers";
import { artifacts } from "./web3";

export type AgentTokenType = 'vault' | 'pool' | 'fasset';

const IERC20 = artifacts.require("IERC20Metadata");

export class AgentTokenConverter {
    constructor(
        public context: IAssetAgentBotContext,
        public agentVaultAddress: string,
        public type: AgentTokenType,
    ) { }

    async tokenDecimals(): Promise<number> {
        if (this.type === 'fasset') {
            return Number(await this.context.fAsset.decimals());
        } else {
            const collateral = await this.getCollateral();
            return Number(collateral.decimals);
        }
    }

    async tokenSymbol(): Promise<string> {
        if (this.type === 'fasset') {
            return await this.context.fAsset.symbol();
        } else {
            const collateral = await this.getCollateral();
            const token = await IERC20.at(collateral.token);
            return await token.symbol().catch(() => collateral.tokenFtsoSymbol);
        }
    }

    async getCollateral(): Promise<CollateralType> {
        if (this._collateral == null) {
            if (this.type === 'fasset') throw new Error("Invalid collateral type");
            this._collateral = await this._getCollateral(this.type);
        }
        return this._collateral;
    }

    private _collateral?: CollateralType;

    private async _getCollateral(type: 'vault' | 'pool'): Promise<CollateralType> {
        if (type === 'vault') {
            const agentInfo = await this.context.assetManager.getAgentInfo(this.agentVaultAddress);
            return await this.context.assetManager.getCollateralType(CollateralClass.VAULT, agentInfo.vaultCollateralToken);
        } else {
            return await this.context.assetManager.getCollateralType(CollateralClass.POOL, await this.context.assetManager.getWNat());
        }
    }

    async parseToWei(amount: string) {
        return toBNExp(amount, await this.tokenDecimals());
    }

    async formatAsTokens(amount: BNish, format?: FormatSettings) {
        const decimals = await this.tokenDecimals();
        return formatFixed(toBN(amount), decimals, format);
    }

    async formatAsTokensWithUnit(amount: BNish, format?: FormatSettings) {
        return `${this.formatAsTokens(amount, format)} ${this.tokenSymbol()}`;
    }
}
