import {BlockchainFeeService} from "../../src/fee-service/fee-service";
import {before} from "node:test";
import {expect} from "chai";
import BN from "bn.js";
import { sleepMs } from "../../src/utils/utils";
import { TransactionFeeService } from "../../src/chain-clients/utxo/TransactionFeeService";
import { ChainType } from "../../src/utils/constants";
import { ServiceRepository } from "../../src/ServiceRepository";

let feeService: BlockchainFeeService;
describe("Fee service tests BTC", () => {
    const feeServiceConfig = {
        indexerUrl: process.env.BTC_URL ?? "",
        sleepTimeMs: 5000,
        numberOfBlocksInHistory: 5,
        rateLimitOptions: {
            timeoutMs: 2000
        }
    };

    before(async () => {
        feeService = new BlockchainFeeService(feeServiceConfig)
    });

    it("Should get current block height", async () => {
        const blockHeight = await feeService.getCurrentBlockHeight();
        expect(blockHeight).to.be.gt(0);
    });

    it("Should get latest fee stats", async () => {
        const feeStats = await feeService.getLatestFeeStats();
        expect(feeStats.averageFeePerKB.eqn(0)).to.be.true;
        expect(feeStats.decilesFeePerKB.length).to.be.eq(0);
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

    it("Should start monitoring", async () => {
        expect(feeService.monitoring).to.be.false;
        void feeService.startMonitoringFees();
        expect(feeService.monitoring).to.be.true;
        await feeService.stopMonitoring();
        await sleepMs(2000);
        expect(feeService.monitoring).to.be.false;
    });

    it("Should get fee", async () => {
        void feeService.startMonitoringFees();
        await sleepMs(10000);
        const chainType = ChainType.testBTC;
        ServiceRepository.register(chainType, BlockchainFeeService, feeService);
        const transactionFeeService = new TransactionFeeService(chainType, 2, 1)
        await transactionFeeService.getFeePerKB();
        await feeService.stopMonitoring();
        await sleepMs(2000);
        expect(feeService.monitoring).to.be.false;
    });
});