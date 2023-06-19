import { IAssetTrackedStateContext } from "../../src/fasset-bots/IAssetBotContext";
import { InitialAgentData } from "../../src/state/TrackedAgentState";
import { TrackedState } from "../../src/state/TrackedState";
import { EventFormatter } from "../test-utils/EventFormatter";
import { FuzzingStateAgent } from "./FuzzingStateAgent";

export class FuzzingState extends TrackedState {

    constructor(
        public context: IAssetTrackedStateContext,
        lastEventBlockHandled: number
    ) { super(context, lastEventBlockHandled) }

    override agents!: Map<string, FuzzingStateAgent>;
    override agentsByUnderlying!: Map<string, FuzzingStateAgent>;
    override agentsByPool!: Map<string, FuzzingStateAgent>;

    override getAgent(address: string): FuzzingStateAgent | undefined {
        return this.agents.get(address);
    }

    protected override newAgent(data: InitialAgentData): FuzzingStateAgent {
        return new FuzzingStateAgent(this, data);
    }
}