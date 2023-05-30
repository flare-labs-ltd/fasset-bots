import { IAssetContext } from "../fasset/IAssetContext";

const delayInMs = 60000; // 1min
export class TimeKeeper {
    constructor(
        public context: IAssetContext
    ) { }

    /**
     * Prove that a block with given number and timestamp exists and
     * update the current underlying block info if the provided data higher.
     * This method should be called by minters before minting and by agent's regularly
     * to prevent current block being too outdated, which gives too short time for
     * minting or redemption payment.
     */
    async updateUnderlyingBlock() {
        const proof = await this.context.attestationProvider.proveConfirmedBlockHeightExists();
        await this.context.assetManager.updateCurrentBlock(proof);
    }

    /**
     * Runner that executes every 'delayInMs' milliseconds.
     */
    /* istanbul ignore next */
    run() {
        setInterval(async () => {
            await this.updateUnderlyingBlock();
        }, delayInMs);
    }


}