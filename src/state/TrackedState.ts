import { EventArgs } from "../utils/events/common";
import { AgentCreated, AgentDestroyed } from "../../typechain-truffle/AssetManager";
import { TrackedAgent } from "./TrackedAgent";

export class TrackedState {
    constructor(
    ) {}

        // tracked agents
        agents: Map<string, TrackedAgent> = new Map();                // map agent_address => tracked agent
        agentsByUnderlying: Map<string, TrackedAgent> = new Map();    // map underlying_address => tracked agent

        createAgent(args: EventArgs<AgentCreated>) {
            const agent = new TrackedAgent(args.agentVault, args.owner, args.underlyingAddress);
            this.agents.set(agent.vaultAddress, agent);
            this.agentsByUnderlying.set(agent.underlyingAddress, agent);
            return agent;
        }
    
        destroyAgent(args: EventArgs<AgentDestroyed>) {
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