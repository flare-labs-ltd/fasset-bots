import { IAssetTrackedStateContext } from "../fasset-bots/IAssetBotContext";
import { proveAndUpdateUnderlyingBlock } from "../utils/fasset-helpers";
import { logger } from "../utils/logger";

export class TimeKeeper {
    constructor(
        public address: string,
        public context: IAssetTrackedStateContext,
        public intervalInMs: number,
    ) { }

    interval?: NodeJS.Timer;

    /**
     * Prove that a block with given number and timestamp exists and
     * update the current underlying block info if the provided data is higher.
     * This method should be called by minters before minting and by agent's regularly
     * to prevent current block being too outdated, which gives too short time for
     * minting or redemption payment.
     */
    async updateUnderlyingBlock() {
        logger.info(`Updating underlying block for ${this.context.assetManager.address}...`);
        await proveAndUpdateUnderlyingBlock(this.context, this.address);
        const { 0: underlyingBlock, 1: underlyingTimestamp } = await this.context.assetManager.currentUnderlyingBlock();
        logger.info(`Underlying block updated on ${this.context.assetManager.address}:  block=${underlyingBlock}  timestamp=${underlyingTimestamp}`);
    }

    /**
     * Runner that executes every 'delayInMs' milliseconds.
     */
    /* istanbul ignore next */
    run() {
        void this.updateUnderlyingBlock();  // do not wait whole interval for start
        this.interval = setInterval(async () => {
            await this.updateUnderlyingBlock();
        }, this.intervalInMs);
    }

    /**
     * Clear runner from 'run' function.
     */
    /* istanbul ignore next */
    clear() {
        clearInterval(this.interval);
    }

}
