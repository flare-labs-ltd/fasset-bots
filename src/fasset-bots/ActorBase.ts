import { TrackedState } from "../state/TrackedState";
import { ScopedRunner } from "../utils/events/ScopedRunner";

export enum ActorBaseKind { CHALLENGER, LIQUIDATOR, SYSTEM_KEEPER }


export class ActorBase {
    constructor(
        public runner: ScopedRunner,
        public address: string,
        public state: TrackedState,
    ) {
    }

    async runStep(): Promise<void> {
        throw Error("Each actor needs to provide it's own implementation.");
    }

    // log(text: string) {
    //     if (!this.state.logger) return;
    //     this.state.logger.log(text);
    // }
}