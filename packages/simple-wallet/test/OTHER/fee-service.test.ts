import { BlockchainFeeService } from "../../src/fee-service/fee-service";
import { expect } from "chai";
import { sleepMs } from "../../src/utils/utils";
import { TransactionFeeService } from "../../src/chain-clients/utxo/TransactionFeeService";
import { ChainType } from "../../src/utils/constants";
import { BitcoinWalletConfig, BTC, logger } from "../../src";
import { initializeTestMikroORM, ORM } from "../test-orm/mikro-orm.config";
import { UnprotectedDBWalletKeys } from "../test-orm/UnprotectedDBWalletKey";
import { addConsoleTransportForTests, MockBlockchainAPI } from "../test-util/common_utils";
import { UTXOWalletImplementation } from "../../src/chain-clients/implementations/UTXOWalletImplementation";
import sinon from "sinon";
import BN from "bn.js";

let feeService: BlockchainFeeService;


const BTCMccConnectionTestInitial = {
    urls: [process.env.BTC_URL ?? ""],
    inTestnet: true,
};
let BTCMccConnectionTest: BitcoinWalletConfig;
let testOrm: ORM;
let client: UTXOWalletImplementation;

describe("Fee service tests BTC", () => {
    let removeConsoleLogging: () => void;

    before(async () => {
        removeConsoleLogging = addConsoleTransportForTests(logger);

        testOrm = await initializeTestMikroORM();
        const unprotectedDBWalletKeys = new UnprotectedDBWalletKeys(testOrm.em);
        BTCMccConnectionTest = {
            ...BTCMccConnectionTestInitial,
            em: testOrm.em,
            walletKeys: unprotectedDBWalletKeys,
            enoughConfirmations: 2
        };
        client = BTC.initialize(BTCMccConnectionTest);
        feeService = client.feeService;
        feeService.sleepTimeMs = 2000;

        await feeService.setupHistory();
    });

    after(async () => {
        removeConsoleLogging();
    });

    it("Should get current block height", async () => {
        const blockHeight = await feeService.getCurrentBlockHeight();
        expect(blockHeight).to.be.gt(0);
    });

    it("Should get latest fee stats", async () => {
        const feeStats = feeService.getLatestFeeStats();
        expect(feeStats.gten(0)).to.be.true;
    });

    it("Should get fee stats", async () => {
        const blockHeight = 2870843;
        const feeStats = await feeService.getFeeStatsFromIndexer(blockHeight);
        expect(feeStats!.averageFeePerKB.gtn(0)).to.be.true;
    });

    it("Fee stats for block without information/non existent block should be null", async () => {
        const blockHeight = await feeService.getCurrentBlockHeight() + 10;
        const feeStats = await feeService.getFeeStatsFromIndexer(blockHeight);
        const feeStatsWithRetires = await feeService.getFeeStatsFromIndexer(blockHeight);
        expect(feeStats).to.be.null;
        expect(feeStatsWithRetires).to.be.null;
    });

    it("Should get fee and median time", async () => {
        client.blockchainAPI = new MockBlockchainAPI();
        let monitoringFees = true;
        void feeService.monitorFees(() => monitoringFees);
        await sleepMs(5000);
        const chainType = ChainType.testBTC;
        const transactionFeeService = new TransactionFeeService(client, chainType, 1)
        await transactionFeeService.getFeePerKB();
        const medianTime = feeService.getLatestMedianTime();
        expect(medianTime?.gtn(0)).to.be.true;
        monitoringFees = false;
    });

    it("If fetching fee stats fails it should be retried until number of tries passes the limit", async () => {
        const stub = sinon.stub(feeService, "getFeeStatsFromIndexer");
        stub.onCall(0).throws(new Error("API not available"));
        stub.onCall(1).throws(new Error("API not available"));
        stub.onCall(2).returns(Promise.resolve({
            blockHeight: 123,
            averageFeePerKB: new BN(1000),
            blockTime: new BN(600),
        }));

        const feeStats = await feeService.getFeeStatsFromIndexer(123);
        expect(feeStats).to.not.be.null;
        expect(feeStats!.averageFeePerKB.eq(new BN(1000))).to.be.true;
        expect(feeStats!.blockTime.eq(new BN(600))).to.be.true;

        sinon.restore();
    });

});
