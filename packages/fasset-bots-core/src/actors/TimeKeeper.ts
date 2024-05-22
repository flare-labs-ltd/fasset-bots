import { ConfirmedBlockHeightExists } from "@flarenetwork/state-connector-protocol";
import { ITimekeeperContext } from "../fasset-bots/IAssetBotContext";
import { attestationProved } from "../underlying-chain/AttestationHelper";
import { sleep, web3DeepNormalize } from "../utils";
import { attestationWindowSeconds } from "../utils/fasset-helpers";
import { logger } from "../utils/logger";
import { CancelToken, PromiseCancelled, cancelableSleep } from "../utils/mini-truffle-contracts/cancelable-promises";

export type TimeKeeperQueryWindow = number | "auto";

export interface TimekeeperTimingConfig {
    /**
     * Smallest query window on attestation client, in seconds (if set to "auto", value from asset manager settings is used).
     */
    queryWindow: TimeKeeperQueryWindow;

    /**
     * The amount of time (in milliseconds) between starting two consecutive updates.
     */
    updateIntervalMs: number;

    /**
     * Sleep time (in milliseconds) between checks for finalization.
     */
    loopDelayMs: number;

    /**
     * To avoid too many updates of independent bots, only execute update if the current stored underlying time is more than
     * this amount of seconds older of the underlying time in this timekeeper's proof.
     */
    maxUnderlyingTimestampAgeS: number;

    /**
     * To prevent many bots submitting time concurrently (immediately after SC round finalization),
     * delay execution time by a random number of milliseconds, up to this amount.
     */
    maxUpdateTimeDelayMs: number;
}

export class TimeKeeper {
    static deepCopyWithObjectCreate = true;

    constructor(
        public context: ITimekeeperContext,
        public address: string,
        public timing: TimekeeperTimingConfig,
    ) {}

    private timer?: NodeJS.Timeout;
    private cancelUpdate?: CancelToken;

    // last proof, to be used by other services (e.g. agent bot)
    latestProof?: ConfirmedBlockHeightExists.Proof;

    /**
     * Prove that a block with given number and timestamp exists and
     * update the current underlying block info if the provided data is higher.
     * This method should be called by minters before minting and by agent's regularly
     * to prevent current block being too outdated, which gives too short time for
     * minting or redemption payment.
     */
    async updateUnderlyingBlock() {
        this.cancelUpdate = new CancelToken();
        try {
            const queryWindow = this.timing.queryWindow === "auto" ? await attestationWindowSeconds(this.context.assetManager) : this.timing.queryWindow;
            const proof = await this.proveConfirmedBlockHeightExists(queryWindow, this.cancelUpdate);
            // update last proof (make sure that block number is increasing, if something weird happens)
            if (this.latestProof == undefined || Number(this.latestProof.data.requestBody.blockNumber) < Number(proof.data.requestBody.blockNumber)) {
                this.latestProof = proof;
            }
            // update block on chain
            await this.executeCurrentBlockUpdate(proof, this.cancelUpdate);
        } catch (error) {
            if (error instanceof PromiseCancelled) return;
            console.error(`Error updating underlying block for asset manager ${this.context.assetManager.address} with user ${this.address}: ${error}`);
            logger.error(`Error updating underlying block for asset manager ${this.context.assetManager.address} with user ${this.address}:`, error);
        } finally {
            this.cancelUpdate = undefined;
        }
    }

    async executeCurrentBlockUpdate(proof: ConfirmedBlockHeightExists.Proof, cancelUpdate: CancelToken) {
        const delay = Math.floor(Math.random() * this.timing.maxUpdateTimeDelayMs);
        await cancelableSleep(delay, cancelUpdate);
        const { 0: _underlyingBlock, 1: underlyingTimestamp } = await this.context.assetManager.currentUnderlyingBlock();
        if (Number(proof.data.responseBody.blockTimestamp) - Number(underlyingTimestamp) < this.timing.maxUnderlyingTimestampAgeS) {
            logger.info(`Underlying block already refreshed, skipping update.`)
            return;
        }
        await this.context.assetManager.updateCurrentBlock(web3DeepNormalize(proof), { from: this.address });
        const { 0: newUnderlyingBlock, 1: newUnderlyingTimestamp } = await this.context.assetManager.currentUnderlyingBlock();
        logger.info(`Underlying block updated for asset manager ${this.context.assetManager.address} with user ${this.address}: block=${newUnderlyingBlock} timestamp=${newUnderlyingTimestamp}`);
    }

    updateRunning() {
        return this.cancelUpdate != undefined;
    }

    /**
     * Like AttestationHelper.proveConfirmedBlockHeightExists, but allows stopping while waiting for proof.
     */
    private async proveConfirmedBlockHeightExists(queryWindow: number, cancelUpdate: CancelToken) {
        logger.info(`Updating underlying block for asset manager ${this.context.assetManager.address} with user ${this.address}...`);
        const request = await this.context.attestationProvider.requestConfirmedBlockHeightExistsProof(queryWindow);
        if (request == null) {
            throw new Error("Timekeeper: balanceDecreasingTransaction: not proved");
        }
        while (!(await this.context.attestationProvider.stateConnector.roundFinalized(request.round))) {
            await cancelableSleep(this.timing.loopDelayMs, cancelUpdate);
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
    run() {
        setImmediate(() => void this.updateUnderlyingBlock()); // do not wait whole interval for start
        this.timer = setInterval(() => void this.updateUnderlyingBlock(), this.timing.updateIntervalMs);
    }

    /**
     * Clear runner from 'run' function.
     */
    stop() {
        clearInterval(this.timer);
        this.timer = undefined;
        this.cancelUpdate?.cancel();
    }

    async waitStop() {
        while (this.updateRunning()) {
            await sleep(100);
        }
    }
}
