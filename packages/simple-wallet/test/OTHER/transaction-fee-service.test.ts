import {expect} from "chai";
import { FeeStatus, TransactionFeeService } from "../../src/chain-clients/utxo/TransactionFeeService";
import { BTC_LOW_FEE_PER_KB, BTC_MID_FEE_PER_KB, ChainType, DOGE_LOW_FEE_PER_KB, DOGE_MID_FEE_PER_KB, TEST_BTC_LOW_FEE_PER_KB, TEST_BTC_MID_FEE_PER_KB, TEST_DOGE_LOW_FEE_PER_KB, TEST_DOGE_MID_FEE_PER_KB } from "../../src/utils/constants";
import sinon from "sinon";

describe("Transaction fee service tests", () => {

    afterEach(() => {
        sinon.restore(); // Restore the original functionality after each test
    });

    it("Should get current fee status - DOGE", async () => {
        const feeService = new TransactionFeeService(ChainType.DOGE, 2, 1)
        sinon.stub(feeService, 'getFeePerKB')
            .onFirstCall().resolves(DOGE_MID_FEE_PER_KB)
            .onSecondCall().resolves(DOGE_LOW_FEE_PER_KB)
            .onThirdCall().resolves(DOGE_LOW_FEE_PER_KB.subn(1));

        const status1 = await feeService.getCurrentFeeStatus();
        expect(status1).to.equal(FeeStatus.HIGH);
        const status2 = await feeService.getCurrentFeeStatus();
        expect(status2).to.equal(FeeStatus.MEDIUM);
        const status3 = await feeService.getCurrentFeeStatus();
        expect(status3).to.equal(FeeStatus.LOW);
    });

    it("Should get current fee status - testDOGE", async () => {
        const feeService = new TransactionFeeService(ChainType.testDOGE, 2, 1)
        sinon.stub(feeService, 'getFeePerKB')
            .onFirstCall().resolves(TEST_DOGE_MID_FEE_PER_KB)
            .onSecondCall().resolves(TEST_DOGE_LOW_FEE_PER_KB)
            .onThirdCall().resolves(TEST_DOGE_LOW_FEE_PER_KB.subn(1));

        const status1 = await feeService.getCurrentFeeStatus();
        expect(status1).to.equal(FeeStatus.HIGH);
        const status2 = await feeService.getCurrentFeeStatus();
        expect(status2).to.equal(FeeStatus.MEDIUM);
        const status3 = await feeService.getCurrentFeeStatus();
        expect(status3).to.equal(FeeStatus.LOW);
    });

    it("Should get current fee status - BTC", async () => {
        const feeService = new TransactionFeeService(ChainType.BTC, 2, 1)
        sinon.stub(feeService, 'getFeePerKB')
            .onFirstCall().resolves(BTC_MID_FEE_PER_KB)
            .onSecondCall().resolves(BTC_LOW_FEE_PER_KB)
            .onThirdCall().resolves(BTC_LOW_FEE_PER_KB.subn(1));

        const status1 = await feeService.getCurrentFeeStatus();
        expect(status1).to.equal(FeeStatus.HIGH);
        const status2 = await feeService.getCurrentFeeStatus();
        expect(status2).to.equal(FeeStatus.MEDIUM);
        const status3 = await feeService.getCurrentFeeStatus();
        expect(status3).to.equal(FeeStatus.LOW);
    });

    it("Should get current fee status - testBTC", async () => {
        const feeService = new TransactionFeeService(ChainType.testBTC, 2, 1)
        sinon.stub(feeService, 'getFeePerKB')
            .onFirstCall().resolves(TEST_BTC_MID_FEE_PER_KB)
            .onSecondCall().resolves(TEST_BTC_LOW_FEE_PER_KB)
            .onThirdCall().resolves(TEST_BTC_LOW_FEE_PER_KB.subn(1));

        const status1 = await feeService.getCurrentFeeStatus();
        expect(status1).to.equal(FeeStatus.HIGH);
        const status2 = await feeService.getCurrentFeeStatus();
        expect(status2).to.equal(FeeStatus.MEDIUM);
        const status3 = await feeService.getCurrentFeeStatus();
        expect(status3).to.equal(FeeStatus.LOW);
    });

    it("Should get current fee status - unsupported", async () => {
        const feeService = new TransactionFeeService("LTC" as ChainType, 2, 1)
        sinon.stub(feeService, 'getFeePerKB').resolves(TEST_BTC_LOW_FEE_PER_KB.subn(1));
        const status = await feeService.getCurrentFeeStatus();
        expect(status).to.equal(FeeStatus.MEDIUM);
    });
});