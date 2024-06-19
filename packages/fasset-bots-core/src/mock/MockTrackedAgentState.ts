import BN from "bn.js";
import { InitialAgentData, TrackedAgentState } from "../state/TrackedAgentState";
import { TrackedState } from "../state/TrackedState";
import { CollateralType } from "../fasset/AssetManagerTypes";

export class MockTrackedAgentState extends TrackedAgentState {
    constructor(
        public parent: TrackedState,
        data: InitialAgentData
    ) {
        super(parent, data);
    }

    override collateralRatioBIPS(collateral: CollateralType, timestamp: BN): BN {
        throw new Error("Faulty calculation.");
    }
}
