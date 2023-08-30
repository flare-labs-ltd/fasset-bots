import { InitialAgentData, TrackedAgentState } from "./TrackedAgentState";
import { TrackedState } from "./TrackedState";

export class MockTrackedAgentState extends TrackedAgentState {
    constructor(
        public parent: TrackedState,
        data: InitialAgentData
    ) {
        super(parent, data);
    }

    override collateralRatioBIPS(): BN {
        throw new Error("Faulty calculation.");
    }
}
