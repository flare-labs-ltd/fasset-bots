import { time } from "@openzeppelin/test-helpers";
import { MockChain } from "../../src/mock/MockChain";
import { latestBlockTimestamp } from "../../src/utils/web3helpers";
import { FuzzingRunner } from "./FuzzingRunner";
import { web3 } from "../../src/utils/web3";

export class FuzzingTimeline {
    constructor(
        public chain: MockChain,
        public runner: FuzzingRunner
    ) {}

    // Skip `seconds` of time
    // While skipping, mines underlying blocks at the rate of chain.secondsPerBlock.
    async skipTime(seconds: number) {
        const startFlareTime = await latestBlockTimestamp();
        const startUnderlyingTime = this.chain.currentTimestamp();

        let skippedTime = 0;
        // eslint-disable-next-line no-constant-condition
        while (true) {
            // mine next block unless skip of `seconds` is reached
            const nextBlockSkip = skippedTime + this.chain.nextBlockTimestamp() - this.chain.currentTimestamp();
            if (nextBlockSkip <= seconds) {
                this.chain.mine();
                skippedTime = this.chain.lastBlockTimestamp() - startUnderlyingTime;
            } else {
                skippedTime = seconds;
                break;
            }
        }
        // increase timestamps
        const newFlareTime = Math.min(startFlareTime, this.chain.lastBlockTimestamp());
        if (newFlareTime > startFlareTime) {
            await time.increaseTo(newFlareTime);
        }
        if (startUnderlyingTime > this.chain.currentTimestamp()) {
            this.chain.skipTimeTo(startUnderlyingTime);
        }
        this.runner.comment(`***** SKIPPED TIME  flare=${newFlareTime - startFlareTime}  chain=${this.chain.currentTimestamp() - startUnderlyingTime}`);
        this.runner.comment(`***** BLOCKS  flare=${(await web3.eth.getBlock("latest")).number}, ${await latestBlockTimestamp()}  chain=${await this.chain.getBlockHeight()}, ${this.chain.lastBlockTimestamp()}`);
    }
}
