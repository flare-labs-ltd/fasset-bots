import { IAssetActorContext } from "../fasset-bots/IAssetBotContext";
import { proveAndUpdateUnderlyingBlock } from "../utils/fasset-helpers";
import { logger } from "../utils/logger";

export class TimeKeeper {
    constructor(
        public address: string,
        public context: IAssetActorContext,
        public intervalInMs: number
    ) {}

    interval?: NodeJS.Timeout;

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
            await proveAndUpdateUnderlyingBlock(this.context, this.address);
            const { 0: underlyingBlock, 1: underlyingTimestamp } = await this.context.assetManager.currentUnderlyingBlock();
            logger.info(
                `Underlying block updated for asset manager ${this.context.assetManager.address} with user ${this.address}: block=${underlyingBlock} timestamp=${underlyingTimestamp}`
            );
        } catch (err) {
            console.error(`Error updating underlying block for asset manager ${this.context.assetManager.address} with user ${this.address}: ${err}`);
            logger.error(`Error updating underlying block for asset manager ${this.context.assetManager.address} with user ${this.address}: ${err}`);
        }
    }

    /**
     * Runner that executes every 'delayInMs' milliseconds.
     */
    /* istanbul ignore next */
    run() {
        try {
            void this.updateUnderlyingBlock(); // do not wait whole interval for start
            this.interval = setInterval(async () => {
                await this.updateUnderlyingBlock();
            }, this.intervalInMs);
        } catch (err) {
            console.error(`Error running timeKeeper for asset manager ${this.context.assetManager.address} with user ${this.address}: ${err}`);
            logger.error(`Error running timeKeeper for asset manager ${this.context.assetManager.address} with user ${this.address}: ${err}`);
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
