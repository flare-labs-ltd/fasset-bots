import { EventArgs } from "../utils/events/common";
import { AgentCreated, AgentDestroyed } from "../../typechain-truffle/AssetManager";
import { TrackedAgent } from "./TrackedAgent";
import { IAssetBotContext } from "../fasset-bots/IAssetBotContext";

export class TrackedState {
    constructor(
    ) { }

    // tracked agents
    agents: Map<string, TrackedAgent> = new Map();                // map agent_address => tracked agent
    agentsByUnderlying: Map<string, TrackedAgent> = new Map();    // map underlying_address => tracked agent

    async createAgentWithCurrentState(vaultAddress: string, context: IAssetBotContext) {
        const storedAgent = this.agents.get(vaultAddress);
        if (!storedAgent) {
            const agentInfo = await context.assetManager.getAgentInfo(vaultAddress);
            const agent = this.createAgent(vaultAddress, agentInfo.ownerAddress, agentInfo.underlyingAddressString);
            agent.initialize(agentInfo);
        }
    }

    createAgent(vaultAddress: string, ownerAddress: string, underlyingAddress: string): TrackedAgent {
        const agent = new TrackedAgent(vaultAddress, ownerAddress, underlyingAddress);
        this.agents.set(agent.vaultAddress, agent);
        this.agentsByUnderlying.set(agent.underlyingAddress, agent);
        return agent;
    }

    destroyAgent(args: EventArgs<AgentDestroyed>): void {
        const agent = this.getAgent(args.agentVault);
        if (agent) {
            this.agents.delete(args.agentVault);
            this.agentsByUnderlying.delete(agent.underlyingAddress);
        }
    }

    getAgent(vaultAddress: string): TrackedAgent | undefined {
        return this.agents.get(vaultAddress);
    }
}