import { AgentVaultInstance } from "../../typechain-truffle";
import { Agent } from "../fasset/Agent";
import { artifacts } from "../utils/artifacts";
import { findRequiredEvent } from "../utils/events/truffle";
import { IAssetBotContext } from "./IAssetBotContext";

const AgentVault = artifacts.require('AgentVault');

export class AgentB extends Agent {
    constructor(
        public context: IAssetBotContext,
        public ownerAddress: string,
        public agentVault: AgentVaultInstance,
        public underlyingAddress: string,
    ) {
        super(context, ownerAddress, agentVault, underlyingAddress);
    }

    static async create(ctx: IAssetBotContext, ownerAddress: string, underlyingAddress: string) {
        // create agent
        const response = await ctx.assetManager.createAgent(underlyingAddress, { from: ownerAddress });
        // extract agent vault address from AgentCreated event
        const event = findRequiredEvent(response, 'AgentCreated');
        // get vault contract at agent's vault address address
        const agentVault = await AgentVault.at(event.args.agentVault);
        // create object
        return new AgentB(ctx, ownerAddress, agentVault, underlyingAddress);
    }
}