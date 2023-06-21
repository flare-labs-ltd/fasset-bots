import { IAssetTrackedStateContext } from "../fasset-bots/IAssetBotContext";
import { proveAndUpdateUnderlyingBlock } from "../utils/fasset-helpers";

const delayInMs = 60000; // 1min
export class TimeKeeper {
    constructor(
        public context: IAssetTrackedStateContext
    ) { }

    interval: any;
    /**
     * Prove that a block with given number and timestamp exists and
     * update the current underlying block info if the provided data is higher.
     * This method should be called by minters before minting and by agent's regularly
     * to prevent current block being too outdated, which gives too short time for
     * minting or redemption payment.
     */
    async updateUnderlyingBlock() {
        await proveAndUpdateUnderlyingBlock(this.context);
    }

    /**
     * Runner that executes every 'delayInMs' milliseconds.
     */
    /* istanbul ignore next */
    run() {
        this.interval = setInterval(async () => {
            await this.updateUnderlyingBlock();
        }, delayInMs);
    }

    /**
     * Clear runner from 'run' function.
     */
    /* istanbul ignore next */
    clear() {
        clearInterval(this.interval);
    }

}