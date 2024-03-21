import { BotConfig, BotFAssetConfig } from "../config/BotConfig";
import { createActorAssetContext } from "../config/create-asset-context";
import { ActorBase, ActorBaseKind } from "../fasset-bots/ActorBase";
import { TrackedState } from "../state/TrackedState";
import { ScopedRunner } from "../utils/events/ScopedRunner";
import { sleep } from "../utils/helpers";
import { logger } from "../utils/logger";
import { web3 } from "../utils/web3";
import { Challenger } from "./Challenger";
import { Liquidator } from "./Liquidator";
import { SystemKeeper } from "./SystemKeeper";

export class ActorBaseRunner {
    static deepCopyWithObjectCreate = true;

    constructor(
        public loopDelay: number,
        public actor: ActorBase
    ) {}

    private stopRequested = false;

    /**
     * @param kind - actor's kind (Challenger, Liquidator or SystemKeeper)
     */
    async run(kind: ActorBaseKind): Promise<void> {
        this.stopRequested = false;
        while (!this.stopRequested) {
            await this.runStep(kind);
            await sleep(this.loopDelay);
        }
    }

    requestStop(): void {
        this.stopRequested = true;
    }

    /**
     * This is the main method, where "automatic" logic is gathered.
     * It runs actor runsStep method, which handles required events and other.
     * @param kind - actor's kind (Challenger, Liquidator or SystemKeeper)
     */
    async runStep(kind: ActorBaseKind): Promise<void> {
        try {
            logger.info(`${ActorBaseKind[kind]}'s ${this.actor.address} ActorBaseRunner started running steps ${this.actor.address}.`);
            await this.actor.runStep();
            logger.info(`${ActorBaseKind[kind]}'s ${this.actor.address} ActorBaseRunner finished running steps ${this.actor.address}.`);
        } catch (error) {
            console.error(`Error with ${ActorBaseKind[kind]} ${this.actor.address}: ${error}`);
            logger.error(`${ActorBaseKind[kind]}'s ${this.actor.address} ActorBaseRunner run into error:`, error);
        }
    }

    /**
     * Creates instance ActorBaseRunner from ActorConfig, native address and kind of actor (Challenger, Liquidator or SystemKeeper)
     * @param config - configs to run bot
     * @param address - actor's native address
     * @param kind - actor's kind (Challenger, Liquidator or SystemKeeper)
     * @returns instance of ActorBaseRunner
     */
    static async create(config: BotConfig, address: string, kind: ActorBaseKind, fAsset: BotFAssetConfig): Promise<ActorBaseRunner> {
        logger.info(`${ActorBaseKind[kind]} ${address} started to create ActorBaseRunner.`);
        const assetContext = await createActorAssetContext(config, fAsset, kind);
        logger.info(`${ActorBaseKind[kind]} ${address} initialized asset context for ActorBaseRunner.`);
        const lastBlock = await web3.eth.getBlockNumber();
        const trackedState = new TrackedState(assetContext, lastBlock);
        await trackedState.initialize();
        logger.info(`${ActorBaseKind[kind]} ${address} initialized tracked state for ActorBaseRunner.`);
        let actor: ActorBase;
        if (kind === ActorBaseKind.CHALLENGER) {
            const blockHeight = await assetContext.blockchainIndexer!.getBlockHeight();
            actor = new Challenger(new ScopedRunner(), address, trackedState, blockHeight, config.notifiers);
        } else if (kind === ActorBaseKind.LIQUIDATOR) {
            actor = new Liquidator(new ScopedRunner(), address, trackedState, config.notifiers);
        } else {
            actor = new SystemKeeper(new ScopedRunner(), address, trackedState);
        }
        logger.info(`${ActorBaseKind[kind]} ${address} was created.`);
        logger.info(`${ActorBaseKind[kind]} ${address} created ActorBaseRunner.`);
        return new ActorBaseRunner(config.loopDelay, actor);
    }
}
