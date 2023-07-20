import { TrackedStateConfig } from "../config/BotConfig";
import { sleep } from "../utils/helpers";
import { ActorBase, ActorBaseKind } from "../fasset-bots/ActorBase";
import { TrackedState } from "../state/TrackedState";
import { createTrackedStateAssetContext } from "../config/create-asset-context";
import { web3 } from "../utils/web3";
import { Challenger } from "./Challenger";
import { ScopedRunner } from "../utils/events/ScopedRunner";
import { Liquidator } from "./Liquidator";
import { SystemKeeper } from "./SystemKeeper";

export class ActorBaseRunner {
    constructor(
        public loopDelay: number,
        public actor: ActorBase
    ) { }

    private stopRequested = false;

    async run(): Promise<void> {
        this.stopRequested = false;
        while (!this.stopRequested) {
            await this.runStep();
            await sleep(this.loopDelay);
        }
    }

    requestStop(): void {
        this.stopRequested = true;
    }

    /**
     * This is the main method, where "automatic" logic is gathered.
     * It runs actor runsStep method, which handles required events and other.
     */
    async runStep(): Promise<void> {
        try {
            await this.actor.runStep();
        } catch (error) {
            console.error(`Error with agent ${this.actor.address}: ${error}`);
        }
    }

    /**
     * Creates ActorBase runner from TrackedStateConfig, native address and kind of actor (Challenger, Liquidator or SystemKeeper)
     * @param config - configs to run bot
     * @param address - actor's native address
     * @param kind - actor's kind (Challenger, Liquidator or SystemKeeper)
     */
    static async create(config: TrackedStateConfig, address: string, kind: ActorBaseKind): Promise<ActorBaseRunner> {
        const assetContext = await createTrackedStateAssetContext(config, config.chains[0]);
        const lastBlock = await web3.eth.getBlockNumber();
        const trackedState = new TrackedState(assetContext, lastBlock);
        await trackedState.initialize();
        let actor: ActorBase;
        if (kind === ActorBaseKind.CHALLENGER) {
            const blockHeight = await assetContext.blockchainIndexer.getBlockHeight();
            actor = new Challenger(new ScopedRunner(), address, trackedState, blockHeight);
        } else if (kind === ActorBaseKind.LIQUIDATOR) {
            actor = new Liquidator(new ScopedRunner(), address, trackedState);
        } else {
            actor = new SystemKeeper(new ScopedRunner(), address, trackedState);
        }
        return new ActorBaseRunner(config.loopDelay, actor);
    }
}
