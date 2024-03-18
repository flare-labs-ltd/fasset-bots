import { BotConfig } from "../config/BotConfig";
import { createActorAssetContext } from "../config/create-asset-context";
import { ActorBaseKind } from "../fasset-bots/ActorBase";
import { IAssetActorContext } from "../fasset-bots/IAssetBotContext";
import { sleep } from "../utils";
import { proveAndUpdateUnderlyingBlock } from "../utils/fasset-helpers";
import { logger } from "../utils/logger";

export class TimeKeeper {
    constructor(
        public address: string,
        public context: IAssetActorContext,
        public intervalInMs: number
    ) { }

    interval?: NodeJS.Timeout;

    static async startTimekeepers(config: BotConfig, timekeeperAddress: string, interval: number) {
        const timekeepers: TimeKeeper[] = [];
        for (const chain of config.fAssets) {
            const assetContext = await createActorAssetContext(config, chain, ActorBaseKind.TIME_KEEPER);
            const timekeeper = new TimeKeeper(timekeeperAddress, assetContext, interval);
            timekeepers.push(timekeeper);
            timekeeper.run();
            // to avoid 'nonce too low' and 'replacement transaction underpriced'
            await sleep(config.loopDelay);
        }
        return timekeepers;
    }

    static async stopTimekeepers(timekeepers: TimeKeeper[]) {
        for (const timekeeper of timekeepers) {
            timekeeper.clear();
        }
    }

    /**
     * Prove that a block with given number and timestamp exists and
     * update the current underlying block info if the provided data is higher.
     * This method should be called by minters before minting and by agent's regularly
     * to prevent current block being too outdated, which gives too short time for
     * minting or redemption payment.
     */
    async updateUnderlyingBlock() {
        try {
            logger.info(`Updating underlying block for asset manager ${this.context.assetManager.address} with user ${this.address}...`);
            await proveAndUpdateUnderlyingBlock(this.context.attestationProvider!, this.context.assetManager, this.address);
            const { 0: underlyingBlock, 1: underlyingTimestamp } = await this.context.assetManager.currentUnderlyingBlock();
            logger.info(`Underlying block updated for asset manager ${this.context.assetManager.address} with user ${this.address}: block=${underlyingBlock} timestamp=${underlyingTimestamp}`);
        } catch (err) {
            console.error(`Error updating underlying block for asset manager ${this.context.assetManager.address} with user ${this.address}: ${err}`);
            logger.error(`Error updating underlying block for asset manager ${this.context.assetManager.address} with user ${this.address}:`, err);
        }
    }

    /**
     * Runner that executes every 'delayInMs' milliseconds.
     */
    /* istanbul ignore next */
    run() {
        try {
            void this.updateUnderlyingBlock(); // do not wait whole interval for start
            // eslint-disable-next-line @typescript-eslint/no-misused-promises
            this.interval = setInterval(async () => {
                await this.updateUnderlyingBlock();
            }, this.intervalInMs);
        } catch (err) {
            console.error(`Error running timeKeeper for asset manager ${this.context.assetManager.address} with user ${this.address}: ${err}`);
            logger.error(`Error running timeKeeper for asset manager ${this.context.assetManager.address} with user ${this.address}:`, err);
        }
    }

    /**
     * Clear runner from 'run' function.
     */
    /* istanbul ignore next */
    clear() {
        clearInterval(this.interval);
    }
}
