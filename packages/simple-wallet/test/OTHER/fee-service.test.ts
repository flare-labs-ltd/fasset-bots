import {BlockchainFeeService} from "../../src/fee-service/fee-service";
import {expect} from "chai";
import { checkIfShouldStillSubmit, sleepMs } from "../../src/utils/utils";
import { TransactionFeeService } from "../../src/chain-clients/utxo/TransactionFeeService";
import { ChainType } from "../../src/utils/constants";
import { BlockchainAPIWrapper } from "../../src/blockchain-apis/UTXOBlockchainAPIWrapper";
import { ServiceRepository } from "../../src/ServiceRepository";
import { MockBlockchainAPI } from "../test-util/utils";
import { BitcoinWalletConfig, BTC, logger } from "../../src";
import { initializeTestMikroORM, ORM } from "../test-orm/mikro-orm.config";
import { UnprotectedDBWalletKeys } from "../test-orm/UnprotectedDBWalletKey";
import { addConsoleTransportForTests } from "../test-util/util";
import { UTXOWalletImplementation } from "../../src/chain-clients/implementations/UTXOWalletImplementation";

let feeService: BlockchainFeeService;
const chainType = ChainType.testBTC;


const BTCMccConnectionTestInitial = {
    url: process.env.BTC_URL ?? "",
    inTestnet: true,
    fallbackAPIs: [
        { url: process.env.BTC_URL ?? "", }
    ]
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
        client = await BTC.initialize(BTCMccConnectionTest);
        feeService = ServiceRepository.get(chainType, BlockchainFeeService);
    });

    it("Should get current block height", async () => {
        const blockHeight = await feeService.getCurrentBlockHeight();
        expect(blockHeight).to.be.gt(0);
    });

    it("Should get latest fee stats", async () => {
        const feeStats = await feeService.getLatestFeeStats();
        expect(feeStats.eqn(0)).to.be.true;
    });

    it("Should get fee stats", async () => {
        const blockHeight = 2870843;
        const feeStats = await feeService.getFeeStatsFromIndexer(blockHeight);
        expect(feeStats!.averageFeePerKB.gtn(0)).to.be.true;
    });

    it("Fee stats for block without information/non existent block should be null", async () => {
        const blockHeight = await feeService.getCurrentBlockHeight() + 10;
        const feeStats = await feeService.getFeeStatsFromIndexer(blockHeight);
        expect(feeStats).to.be.null;
    });

    it("Should start monitoring", async () => {
        expect(feeService.monitoring).to.be.false;
        void feeService.startMonitoringFees();
        expect(feeService.monitoring).to.be.true;
        await feeService.stopMonitoringFees();
        await sleepMs(2000);
        expect(feeService.monitoring).to.be.false;
    });

    it("Should get fee and median time", async () => {
        ServiceRepository.register(ChainType.testBTC, BlockchainAPIWrapper, new MockBlockchainAPI());
        void feeService.startMonitoringFees();
        await sleepMs(10000);
        const chainType = ChainType.testBTC;
        const transactionFeeService = new TransactionFeeService(chainType, 1)
        await transactionFeeService.getFeePerKB();
        const medianTime = feeService.getLatestMedianTime();
        expect(medianTime?.gtn(0)).to.be.true;
        await feeService.stopMonitoringFees();
        await sleepMs(2000);
        expect(feeService.monitoring).to.be.false;
    });
});