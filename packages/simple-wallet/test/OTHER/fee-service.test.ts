import {BlockchainFeeService} from "../../src/fee-service/fee-service";
import {before} from "node:test";
import {expect} from "chai";
import BN from "bn.js";

let feeService: BlockchainFeeService;
describe("Fee service tests BTC", () => {
    const feeServiceConfig = {
        indexerUrl: process.env.BTC_URL ?? "",
        sleepTimeMs: 5000,
        numberOfBlocksInHistory: 5,
    };

    before(async () => {
        feeService = new BlockchainFeeService(feeServiceConfig)
    });

    it("Should get current block height", async () => {
        const blockHeight = await feeService.getCurrentBlockHeight();
        expect(blockHeight).to.be.gt(0);
    });

    it("Should get fee stats", async () => {
        const blockHeight = 2870843;
        const feeStats = await feeService.getFeeStatsFromIndexer(blockHeight);

        expect(feeStats.averageFeePerKB.toNumber()).to.be.gte(0);
        expect(feeStats.decilesFeePerKB.length).to.be.eq(11);
        expect(feeStats.decilesFeePerKB.map((t: BN) => t.toNumber()).filter((t: number) => t >= 0).length).to.be.eq(11);
    });

    it("Fee stats for block without information/non existent block should be {0, []}", async () => {
        const blockHeight = await feeService.getCurrentBlockHeight() + 10;
        const feeStats = await feeService.getFeeStatsFromIndexer(blockHeight);

        expect(feeStats.averageFeePerKB.toNumber()).to.be.eq(0);
        expect(feeStats.decilesFeePerKB.length).to.be.eq(0);
    });
})