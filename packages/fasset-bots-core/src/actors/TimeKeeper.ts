import { KeeperBotConfig, createTimekeeperContext } from "../config";
import { ITimekeeperContext } from "../fasset-bots/IAssetBotContext";
import { attestationProved } from "../underlying-chain/AttestationHelper";
import { sleep, web3DeepNormalize } from "../utils";
import { logger } from "../utils/logger";

export class TimeKeeper {
    static deepCopyWithObjectCreate = true;

    constructor(
        public address: string,
        public context: ITimekeeperContext,
        public intervalInMs: number
    ) {}

    queryWindow = 7200;
    loopDelay: number = 5000;

    stopRequested: boolean = false;
    updateRunning: boolean = false;

    interval?: NodeJS.Timeout;

    static async startTimekeepers(config: KeeperBotConfig, timekeeperAddress: string, interval: number) {
        const timekeepers: TimeKeeper[] = [];
        for (const chain of config.fAssets.values()) {
            const assetContext = await createTimekeeperContext(config, chain);
            const timekeeper = new TimeKeeper(timekeeperAddress, assetContext, interval);
            timekeeper.loopDelay = config.loopDelay;
            timekeepers.push(timekeeper);
            timekeeper.run();
        }
        return timekeepers;
    }

    static async stopTimekeepers(timekeepers: TimeKeeper[]) {
        for (const timekeeper of timekeepers) {
            timekeeper.clear();
        }
        for (const timekeeper of timekeepers) {
            await timekeeper.waitStop();
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
        this.updateRunning = true;
        try {
            const proof = await this.proveConfirmedBlockHeightExists(this.queryWindow);
            if (proof === "STOP REQUESTED") return;
            await this.context.assetManager.updateCurrentBlock(web3DeepNormalize(proof), { from: this.address });
            const { 0: underlyingBlock, 1: underlyingTimestamp } = await this.context.assetManager.currentUnderlyingBlock();
            logger.info(`Underlying block updated for asset manager ${this.context.assetManager.address} with user ${this.address}: block=${underlyingBlock} timestamp=${underlyingTimestamp}`);
        } catch (error) {
            console.error(`Error updating underlying block for asset manager ${this.context.assetManager.address} with user ${this.address}: ${error}`);
            logger.error(`Error updating underlying block for asset manager ${this.context.assetManager.address} with user ${this.address}:`, error);
        } finally {
            this.updateRunning = false;
        }
    }

    // like AttestationHelper.proveConfirmedBlockHeightExists, but allows stopping while waiting for proof
    private async proveConfirmedBlockHeightExists(queryWindow: number) {
        logger.info(`Updating underlying block for asset manager ${this.context.assetManager.address} with user ${this.address}...`);
        const request = await this.context.attestationProvider.requestConfirmedBlockHeightExistsProof(queryWindow);
        if (request == null) {
            throw new Error("Timekeeper: balanceDecreasingTransaction: not proved");
        }
        while (!(await this.context.attestationProvider.stateConnector.roundFinalized(request.round))) {
            if (this.stopRequested) return "STOP REQUESTED";
            await sleep(this.loopDelay);
        }
        logger.info(`Obtained underlying block proof for asset manager ${this.context.assetManager.address}, updating with user ${this.address}...`);
        const proof = await this.context.attestationProvider.obtainConfirmedBlockHeightExistsProof(request.round, request.data);
        if (!attestationProved(proof)) {
            throw new Error("Timekeeper: balanceDecreasingTransaction: not proved");
        }
        return proof;
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
        this.stopRequested = true;
    }

    async waitStop() {
        while (this.updateRunning) {
            await sleep(500);
        }
    }
}
