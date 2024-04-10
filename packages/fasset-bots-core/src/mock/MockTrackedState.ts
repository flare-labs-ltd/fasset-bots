import { AgentDestroyed } from "../../typechain-truffle/IIAssetManager";
import { IAssetNativeChainContext } from "../fasset-bots/IAssetBotContext";
import { InitialAgentData } from "../state/TrackedAgentState";
import { TrackedState } from "../state/TrackedState";
import { EventArgs, EvmEvent } from "../utils/events/common";
import { MockTrackedAgentState } from "./MockTrackedAgentState";

export class MockTrackedState extends TrackedState {
    constructor(
        context: IAssetNativeChainContext,
        currentEventBlock: number,
        public trackedState: TrackedState | null
    ) {
        super(context, currentEventBlock);
    }

    // tracked agents
    override agents: Map<string, MockTrackedAgentState> = new Map();                // map agent_address => tracked agent state
    override agentsByUnderlying: Map<string, MockTrackedAgentState> = new Map();    // map underlying_address => tracked agent state
    override agentsByPool: Map<string, MockTrackedAgentState> = new Map();    // map pool_address => tracked agent state

    override async readUnhandledEvents(): Promise<EvmEvent[]> {
        if (this.trackedState) return this.trackedState.readUnhandledEvents()
        else throw new Error("Faulty handler.")
    }

    override async createAgentWithCurrentState(vaultAddress: string): Promise<MockTrackedAgentState> {
        const agentInfo = await this.context.assetManager.getAgentInfo(vaultAddress);
        const agent = this.createAgent({
            agentVault: vaultAddress,
            owner: agentInfo.ownerManagementAddress,
            underlyingAddress: agentInfo.underlyingAddressString,
            collateralPool: agentInfo.collateralPool,
            vaultCollateralToken: agentInfo.vaultCollateralToken,
            feeBIPS: agentInfo.feeBIPS,
            poolFeeShareBIPS: agentInfo.poolFeeShareBIPS,
            mintingVaultCollateralRatioBIPS: agentInfo.mintingVaultCollateralRatioBIPS,
            mintingPoolCollateralRatioBIPS: agentInfo.mintingPoolCollateralRatioBIPS,
            buyFAssetByAgentFactorBIPS: agentInfo.buyFAssetByAgentFactorBIPS,
            poolExitCollateralRatioBIPS: agentInfo.poolExitCollateralRatioBIPS,
            poolTopupCollateralRatioBIPS: agentInfo.poolTopupCollateralRatioBIPS,
            poolTopupTokenPriceFactorBIPS: agentInfo.poolTopupTokenPriceFactorBIPS,
        });
        agent.initialize(agentInfo);
        return agent;
    }

    override createAgent(data: InitialAgentData): MockTrackedAgentState {
        const agent = this.newAgent(data);
        this.agents.set(agent.vaultAddress, agent);
        this.agentsByUnderlying.set(agent.underlyingAddress, agent);
        this.agentsByPool.set(agent.collateralPoolAddress, agent);
        return agent;
    }

    protected override newAgent(data: InitialAgentData): MockTrackedAgentState {
        return new MockTrackedAgentState(this, data);
    }

    override destroyAgent(args: EventArgs<AgentDestroyed>): void {
        const agent = this.getAgent(args.agentVault);
        if (agent) {
            this.agents.delete(args.agentVault);
            this.agentsByUnderlying.delete(agent.underlyingAddress);
            this.agentsByPool.delete(agent.collateralPoolAddress);
        }
    }

    override getAgent(vaultAddress: string): MockTrackedAgentState | undefined {
        return this.agents.get(vaultAddress);
    }

    override async getAgentTriggerAdd(vaultAddress: string): Promise<MockTrackedAgentState> {
        const agent = this.agents.get(vaultAddress);
        if (!agent) {
            return await this.createAgentWithCurrentState(vaultAddress);
        }
        return agent;
    }

}
