import { AgentVaultInstance, CollateralPoolInstance, CollateralPoolTokenInstance } from "../../typechain-truffle";
import { Agent } from "../fasset/Agent";
import { AgentSettings, CollateralTokenClass } from "../fasset/AssetManagerTypes";
import { artifacts } from "../utils/artifacts";
import { findRequiredEvent } from "../utils/events/truffle";
import { IAssetBotContext } from "./IAssetBotContext";
import { web3DeepNormalize } from "../utils/web3normalize";
import { requireNotNull } from "../utils/helpers";

const AgentVault = artifacts.require('AgentVault');
const CollateralPool = artifacts.require('CollateralPool');
const CollateralPoolToken = artifacts.require('CollateralPoolToken');

export class AgentB extends Agent {
    constructor(
        public context: IAssetBotContext,
        public ownerAddress: string,
        public agentVault: AgentVaultInstance,
        public collateralPool: CollateralPoolInstance,
        public collateralPoolToken: CollateralPoolTokenInstance,
        public settings: AgentSettings
    ) {
        super(context, ownerAddress, agentVault, collateralPool, collateralPoolToken, settings);
    }

    class1Collateral = requireNotNull(this.context.collaterals.find(c => c.tokenClass === CollateralTokenClass.CLASS1 && c.token === this.agentSettings.class1CollateralToken));
    poolCollateral = requireNotNull(this.context.collaterals.find(c => c.tokenClass === CollateralTokenClass.POOL && c.token === this.context.wNat.address));

    static async create(ctx: IAssetBotContext, ownerAddress: string, settings: AgentSettings): Promise<AgentB> {
        // create agent
        const response = await ctx.assetManager.createAgent(web3DeepNormalize(settings), { from: ownerAddress });
        // extract agent vault address from AgentCreated event
        const event = findRequiredEvent(response, 'AgentCreated');
        // get vault contract at agent's vault address address
        const agentVault = await AgentVault.at(event.args.agentVault);
        // get collateral pool
        const collateralPool = await CollateralPool.at(event.args.collateralPool);
        // get pool token
        const poolTokenAddress = await collateralPool.poolToken();
        const collateralPoolToken = await CollateralPoolToken.at(poolTokenAddress);
        // create object
        return new AgentB(ctx, ownerAddress, agentVault, collateralPool, collateralPoolToken, settings);
    }
}