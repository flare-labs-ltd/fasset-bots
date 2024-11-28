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
        feeService.sleepTimeMs = 200;
        feeService.setupHistorySleepTimeMs = 200;

        // setup fee service
        console.log("Starting fee service setup...");
        let monitoring = true;
        void feeService.monitorFees(testOrm.em.fork(), () => monitoring);
        while (feeService.initialSetup) {
            await sleepMs(100);
        }
        monitoring = false;
        console.log("Finished fee service setup");
        while (feeService.running) {
            await sleepMs(100);
        }
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

    it("Should get fee and median time", async () => {
        client.blockchainAPI = new MockBlockchainAPI();
        let monitoringFees = true;
        void feeService.monitorFees(testOrm.em.fork(), () => monitoringFees);
        await sleepMs(5000);
        const chainType = ChainType.testBTC;
        const transactionFeeService = new TransactionFeeService(client, chainType, 1)
        await transactionFeeService.getFeePerKB();
        const medianTime = feeService.getLatestMedianTime();
        expect(medianTime?.gtn(0)).to.be.true;
        monitoringFees = false;
        while (feeService.running) {
            await sleepMs(100);
        }
    });
});
