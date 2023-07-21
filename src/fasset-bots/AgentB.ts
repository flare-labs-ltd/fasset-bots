import { AgentVaultInstance, ContingencyPoolInstance, ContingencyPoolTokenInstance } from "../../typechain-truffle";
import { Agent } from "../fasset/Agent";
import { AgentSettings } from "../fasset/AssetManagerTypes";
import { artifacts } from "../utils/artifacts";
import { findRequiredEvent } from "../utils/events/truffle";
import { IAssetAgentBotContext } from "./IAssetBotContext";
import { web3DeepNormalize } from "../utils/web3normalize";

const AgentVault = artifacts.require('AgentVault');
const ContingencyPool = artifacts.require('ContingencyPool');
const ContingencyPoolToken = artifacts.require('ContingencyPoolToken');

export class AgentB extends Agent {
    constructor(
        public context: IAssetAgentBotContext,
        public ownerAddress: string,
        public agentVault: AgentVaultInstance,
        public contingencyPool: ContingencyPoolInstance,
        public contingencyPoolToken: ContingencyPoolTokenInstance,
        public underlyingAddress: string
    ) {
        super(context, ownerAddress, agentVault, contingencyPool, contingencyPoolToken, underlyingAddress);
    }

    static async create(ctx: IAssetAgentBotContext, ownerAddress: string, settings: AgentSettings): Promise<AgentB> {
        // create agent
        const response = await ctx.assetManager.createAgent(web3DeepNormalize(settings), { from: ownerAddress });
        // extract agent vault address from AgentCreated event
        const event = findRequiredEvent(response, 'AgentCreated');
        // get vault contract at agent's vault address address
        const agentVault = await AgentVault.at(event.args.agentVault);
        // get contingency pool
        const contingencyPool = await ContingencyPool.at(event.args.contingencyPool);
        // get pool token
        const poolTokenAddress = await contingencyPool.poolToken();
        const contingencyPoolToken = await ContingencyPoolToken.at(poolTokenAddress);
        // create object
        return new AgentB(ctx, ownerAddress, agentVault, contingencyPool, contingencyPoolToken, settings.underlyingAddressString);
    }
}
