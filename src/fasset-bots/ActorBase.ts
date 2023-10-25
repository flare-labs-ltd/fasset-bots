import { TrackedState } from "../state/TrackedState";
import { ScopedRunner } from "../utils/events/ScopedRunner";

export enum ActorBaseKind {
    CHALLENGER,
    LIQUIDATOR,
    SYSTEM_KEEPER,
    TIME_KEEPER,
}

export class ActorBase {
    constructor(
        public runner: ScopedRunner,
        public address: string,
        public state: TrackedState
    ) {}

    async runStep(): Promise<void> {
        throw new Error("Each actor needs to provide its own implementation.");
    }
}
