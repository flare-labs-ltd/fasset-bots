import { BotConfig, BotFAssetConfig, BotFAssetConfigWithIndexer, KeeperBotConfig } from "../config/BotConfig";
import { ActorBase, ActorBaseKind } from "../fasset-bots/ActorBase";
import { sleep } from "../utils/helpers";
import { logger } from "../utils/logger";
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
    static async create(config: KeeperBotConfig, address: string, kind: ActorBaseKind.CHALLENGER, fAsset: BotFAssetConfigWithIndexer): Promise<ActorBaseRunner>;
    static async create(config: BotConfig, address: string, kind: ActorBaseKind.LIQUIDATOR | ActorBaseKind.SYSTEM_KEEPER, fAsset: BotFAssetConfig): Promise<ActorBaseRunner>;
    static async create(config: BotConfig, address: string, kind: ActorBaseKind, fAsset: BotFAssetConfig): Promise<ActorBaseRunner> {
        const actor = await ActorBaseRunner.createActor(config, address, kind, fAsset);
        logger.info(`${ActorBaseKind[kind]} ${address} created ActorBaseRunner.`);
        return new ActorBaseRunner(config.loopDelay, actor);
    }

    private static async createActor(config: BotConfig, address: string, kind: ActorBaseKind, fAsset: BotFAssetConfig) {
        switch (kind) {
            case ActorBaseKind.CHALLENGER:
                return await Challenger.create(config as KeeperBotConfig, address, fAsset as BotFAssetConfigWithIndexer);
            case ActorBaseKind.LIQUIDATOR:
                return await Liquidator.create(config, address, fAsset);
            case ActorBaseKind.SYSTEM_KEEPER:
                return await SystemKeeper.create(config, address, fAsset);
            /* istanbul ignore next */
            default:
                throw new Error("Not supported by ActorBaseRunner");
        }
    }
}
