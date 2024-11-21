import sinon from "sinon";
import * as dbutils from "../../src/db/dbutils";
import { BitcoinWalletConfig, BTC, ITransactionMonitor, logger, SpentHeightEnum } from "../../src";
import { toBN } from "web3-utils";
import { addConsoleTransportForTests, resetMonitoringOnForceExit } from "../test-util/common_utils";
import { initializeTestMikroORM, ORM } from "../test-orm/mikro-orm.config";
import { UnprotectedDBWalletKeys } from "../test-orm/UnprotectedDBWalletKey";
import { FeeStatus } from "../../src/chain-clients/utxo/TransactionFeeService";
import BN from "bn.js";
import { expect } from "chai";
import { createUTXOEntity } from "../test-util/entity_utils";

const walletSecret = "wallet_secret";
const BTCMccConnectionTestInitial = {
    urls: [process.env.BTC_URL ?? ""],
    apiTokenKeys: [process.env.FLARE_API_PORTAL_KEY ?? ""],
    inTestnet: true,
    walletSecret: walletSecret,
};
let BTCMccConnectionTest: BitcoinWalletConfig;

const fundedAddress = "tb1qyghw9dla9vl0kutujnajvl6eyj0q2nmnlnx3j0";
const fundedFeeAddress = "tb1q8j7jvsdqxm5e27d48p4382xrq0emrncwfr35k4";
const targetAddress = "tb1q9szxd7rnvkkspxp0sl8mha5jk38q9t3rlc2wjx";

let wClient: BTC;
let testOrm: ORM;
let monitor: ITransactionMonitor;

describe("Unit test for paying fees from additional wallet", () => {

    before(async () => {
        addConsoleTransportForTests(logger);
        testOrm = await initializeTestMikroORM();
        const unprotectedDBWalletKeys = new UnprotectedDBWalletKeys(testOrm.em);
        BTCMccConnectionTest = {
            ...BTCMccConnectionTestInitial,
            em: testOrm.em,
            walletKeys: unprotectedDBWalletKeys,
            enoughConfirmations: 1,
        };
        wClient = BTC.initialize(BTCMccConnectionTest);
        monitor = await wClient.createMonitor();
        await monitor.startMonitoring();
        resetMonitoringOnForceExit(monitor);
    });

    beforeEach(() => {
        sinon.restore();
        sinon.stub(wClient.transactionFeeService, "getCurrentFeeStatus").resolves(FeeStatus.LOW);
        sinon.stub(wClient.transactionFeeService, "getFeePerKB").resolves(new BN(1000));
        sinon.stub(wClient.transactionUTXOService, "getNumberOfMempoolAncestors").resolves(0);
    });

    it("It should create transaction from 'base' wallet even if the 'fee' wallet doesn't have enough funds", async () => {
        sinon.stub(dbutils, "fetchUnspentUTXOs").callsFake((rootEm, source, rbfUTXOs) => {
            if (source === fundedAddress) {
                return Promise.resolve([
                    createUTXOEntity(0, fundedAddress, "ef99f95e95b18adfc44aae79722946e583677eb631a89a1b62fe0e275801a10c", 0, SpentHeightEnum.UNSPENT, toBN(10020), "00143cbd2641a036e99579b5386b13a8c303f3b1cf0e"),
                    createUTXOEntity(0, fundedAddress, "2a6a5d5607492467e357140426f48e75e5ab3fa5fb625b6f201cce284f0dc55e", 0, SpentHeightEnum.UNSPENT, toBN(1000), "00143cbd2641a036e99579b5386b13a8c303f3b1cf0e"),
                    createUTXOEntity(0, fundedAddress, "b895eab0cd280d1bb07897576e2edbdd7791d8b85bb64e28a9b86952faf8fdc2", 0, SpentHeightEnum.UNSPENT, toBN(1000), "00143cbd2641a036e99579b5386b13a8c303f3b1cf0e"),
                ]);
            } else {
                return Promise.resolve([
                    createUTXOEntity(0, fundedFeeAddress, "0b24228b83a64803ccf00f9878d56a0306c4b76f17c4b5bdc1cd35358e04feb5", 0, SpentHeightEnum.UNSPENT, toBN(1000), "00143cbd2641a036e99579b5386b13a8c303f3b1cf0e")
                ]);
            }
        });

        const fee = 2000;
        const [tr, utxos] = await wClient.transactionService.preparePaymentTransactionWithAdditionalFeeWallet(0, fundedAddress, fundedFeeAddress, targetAddress, toBN(1500), toBN(fee));

        expect(utxos.map(t => t.source)).to.include(fundedAddress);
        expect(tr.getFee()).to.be.eq(fee);
    });

    it("It should create transaction from base wallet even if the 'fee' wallet doesn't have any funds", async () => {
        sinon.stub(dbutils, "fetchUnspentUTXOs").callsFake((rootEm, source, rbfUTXOs) => {
            if (source === fundedAddress) {
                return Promise.resolve([
                    createUTXOEntity(0, fundedAddress, "ef99f95e95b18adfc44aae79722946e583677eb631a89a1b62fe0e275801a10c", 0, SpentHeightEnum.UNSPENT, toBN(10020), "00143cbd2641a036e99579b5386b13a8c303f3b1cf0e"),
                    createUTXOEntity(0, fundedAddress, "2a6a5d5607492467e357140426f48e75e5ab3fa5fb625b6f201cce284f0dc55e", 0, SpentHeightEnum.UNSPENT, toBN(1000), "00143cbd2641a036e99579b5386b13a8c303f3b1cf0e"),
                    createUTXOEntity(0, fundedAddress, "b895eab0cd280d1bb07897576e2edbdd7791d8b85bb64e28a9b86952faf8fdc2", 0, SpentHeightEnum.UNSPENT, toBN(1000), "00143cbd2641a036e99579b5386b13a8c303f3b1cf0e"),
                ]);
            } else {
                return Promise.resolve([]);
            }
        });

        const fee = 2000;
        const [tr, utxos] = await wClient.transactionService.preparePaymentTransactionWithAdditionalFeeWallet(0, fundedAddress, fundedFeeAddress, targetAddress, toBN(1500), toBN(fee));

        expect(utxos.filter(t => t.source !== fundedAddress)).to.be.empty;
        expect(tr.getFee()).to.be.eq(fee);
    });

    it("If 'fee' wallet has enough funds fee should be covered from it, remainder should be returned", async () => {
        sinon.stub(dbutils, "fetchUnspentUTXOs").callsFake((rootEm, source, rbfUTXOs) => {
            if (source === fundedAddress) {
                return Promise.resolve([
                    createUTXOEntity(0, fundedAddress, "2a6a5d5607492467e357140426f48e75e5ab3fa5fb625b6f201cce284f0dc55e", 0, SpentHeightEnum.UNSPENT, toBN(1000), "00143cbd2641a036e99579b5386b13a8c303f3b1cf0e"),
                    createUTXOEntity(0, fundedAddress, "b895eab0cd280d1bb07897576e2edbdd7791d8b85bb64e28a9b86952faf8fdc2", 0, SpentHeightEnum.UNSPENT, toBN(1400), "00143cbd2641a036e99579b5386b13a8c303f3b1cf0e"),
                ]);
            } else {
                return Promise.resolve([
                    createUTXOEntity(0, fundedFeeAddress, "0b24228b83a64803ccf00f9878d56a0306c4b76f17c4b5bdc1cd35358e04feb5", 0, SpentHeightEnum.UNSPENT, toBN(3000), "00143cbd2641a036e99579b5386b13a8c303f3b1cf0e")
                ]);
            }
        });

        const fee = 1000;
        const [tr,] = await wClient.transactionService.preparePaymentTransactionWithAdditionalFeeWallet(0, fundedAddress, fundedFeeAddress, targetAddress, toBN(1500), toBN(fee));

        // It should output 1500 (the amount), 2000 (fee remainder), 900 (remainder of amount)
        expect(tr.outputs.length).to.be.eq(3);
        expect(tr.outputs.map(t => t.satoshis)).to.include.members([1500, 2000, 900]);
        expect(tr.getFee()).to.be.eq(fee);
    });

    it("If 'fee' wallet has enough funds fee should be covered from it, remainder should be returned only if it's greater than dust", async () => {
        sinon.stub(dbutils, "fetchUnspentUTXOs").callsFake((rootEm, source, rbfUTXOs) => {
            if (source === fundedAddress) {
                return Promise.resolve([
                    createUTXOEntity(0, fundedAddress, "2a6a5d5607492467e357140426f48e75e5ab3fa5fb625b6f201cce284f0dc55e", 0, SpentHeightEnum.UNSPENT, toBN(1000), "00143cbd2641a036e99579b5386b13a8c303f3b1cf0e"),
                    createUTXOEntity(0, fundedAddress, "b895eab0cd280d1bb07897576e2edbdd7791d8b85bb64e28a9b86952faf8fdc2", 0, SpentHeightEnum.UNSPENT, toBN(1400), "00143cbd2641a036e99579b5386b13a8c303f3b1cf0e"),
                ]);
            } else {
                return Promise.resolve([
                    createUTXOEntity(0, fundedFeeAddress, "0b24228b83a64803ccf00f9878d56a0306c4b76f17c4b5bdc1cd35358e04feb5", 0, SpentHeightEnum.UNSPENT, toBN(2000), "00143cbd2641a036e99579b5386b13a8c303f3b1cf0e")
                ]);
            }
        });

        const fee = 1500;
        const [tr,] = await wClient.transactionService.preparePaymentTransactionWithAdditionalFeeWallet(0, fundedAddress, fundedFeeAddress, targetAddress, toBN(1500), toBN(fee));

        // It should output 1500 (the amount) and 1400 = 4400 (sum of inputs) - 1500 (fee) - 1500 (the amount)
        expect(tr.outputs.length).to.be.eq(2);
        expect(tr.outputs.map(t => t.satoshis)).to.include.members([1500, 1400]);
        expect(tr.getFee()).to.be.eq(fee);
    });

    it("If 'fee' wallet has enough funds fee should be covered from it, remainder should be returned", async () => {
        sinon.stub(dbutils, "fetchUnspentUTXOs").callsFake((rootEm, source, rbfUTXOs) => {
            if (source === fundedAddress) {
                return Promise.resolve([
                    createUTXOEntity(0, fundedAddress, "2a6a5d5607492467e357140426f48e75e5ab3fa5fb625b6f201cce284f0dc55e", 0, SpentHeightEnum.UNSPENT, toBN(1000), "00143cbd2641a036e99579b5386b13a8c303f3b1cf0e"),
                    createUTXOEntity(0, fundedAddress, "b895eab0cd280d1bb07897576e2edbdd7791d8b85bb64e28a9b86952faf8fdc2", 0, SpentHeightEnum.UNSPENT, toBN(1400), "00143cbd2641a036e99579b5386b13a8c303f3b1cf0e"),
                ]);
            } else {
                return Promise.resolve([
                    createUTXOEntity(0, fundedFeeAddress, "0b24228b83a64803ccf00f9878d56a0306c4b76f17c4b5bdc1cd35358e04feb5", 0, SpentHeightEnum.UNSPENT, toBN(2000), "00143cbd2641a036e99579b5386b13a8c303f3b1cf0e")
                ]);
            }
        });

        const [tr,] = await wClient.transactionService.preparePaymentTransactionWithAdditionalFeeWallet(0, fundedAddress, fundedFeeAddress, targetAddress, toBN(1500), undefined);

        // Transaction should have 3 inputs and 3 ouputs => size is 307.5 vB => fee is 307 (since it's 1000sat/vB)
        // Outputs should be 1500 (the amount), 1693 (fee remainder), 900 (amount remainder)
        expect(tr.outputs.length).to.be.eq(3);
        expect(tr.outputs.map(t => t.satoshis)).to.include.members([1500, 1693, 900]);
    });

    it("If 'fee' wallet has enough funds fee should be covered from it if fee is greater than dust", async () => {
        sinon.stub(dbutils, "fetchUnspentUTXOs").callsFake((rootEm, source, rbfUTXOs) => {
            if (source === fundedAddress) {
                return Promise.resolve([
                    createUTXOEntity(0, fundedAddress, "2a6a5d5607492467e357140426f48e75e5ab3fa5fb625b6f201cce284f0dc55e", 0, SpentHeightEnum.UNSPENT, toBN(1000), "00143cbd2641a036e99579b5386b13a8c303f3b1cf0e"),
                    createUTXOEntity(0, fundedAddress, "b895eab0cd280d1bb07897576e2edbdd7791d8b85bb64e28a9b86952faf8fdc2", 0, SpentHeightEnum.UNSPENT, toBN(1400), "00143cbd2641a036e99579b5386b13a8c303f3b1cf0e"),
                ]);
            } else {
                return Promise.resolve([
                    createUTXOEntity(0, fundedFeeAddress, "0b24228b83a64803ccf00f9878d56a0306c4b76f17c4b5bdc1cd35358e04feb5", 0, SpentHeightEnum.UNSPENT, toBN(600), "00143cbd2641a036e99579b5386b13a8c303f3b1cf0e")
                ]);
            }
        });

        const [tr,] = await wClient.transactionService.preparePaymentTransactionWithAdditionalFeeWallet(0, fundedAddress, fundedFeeAddress, targetAddress, toBN(1500), undefined);

        // Transaction should have 2 inputs and 2 ouputs => size is 208.5 vB => fee is 276 (since it's 1000sat/vB)
        // Outputs should be 1500 (the amount), 692 = 2400 - 1500 - 208 (amount remainder)
        expect(tr.inputs.filter(t => t.prevTxId.toString('hex') != "0b24228b83a64803ccf00f9878d56a0306c4b76f17c4b5bdc1cd35358e04feb5").length).to.be.eq(tr.inputs.length);
        expect(tr.outputs.length).to.be.eq(2);
        expect(tr.outputs.map(t => t.satoshis)).to.include.members([1500, 692]);
    });

    it("If 'fee' wallet has enough funds fee should be covered from it, remainder should be returned only if it's greater than dust", async () => {
        sinon.stub(dbutils, "fetchUnspentUTXOs").callsFake((rootEm, source, rbfUTXOs) => {
            if (source === fundedAddress) {
                return Promise.resolve([
                    createUTXOEntity(0, fundedAddress, "2a6a5d5607492467e357140426f48e75e5ab3fa5fb625b6f201cce284f0dc55e", 0, SpentHeightEnum.UNSPENT, toBN(1000), "00143cbd2641a036e99579b5386b13a8c303f3b1cf0e"),
                    createUTXOEntity(0, fundedAddress, "b895eab0cd280d1bb07897576e2edbdd7791d8b85bb64e28a9b86952faf8fdc2", 0, SpentHeightEnum.UNSPENT, toBN(1400), "00143cbd2641a036e99579b5386b13a8c303f3b1cf0e"),
                ]);
            } else {
                return Promise.resolve([
                    createUTXOEntity(0, fundedFeeAddress, "0b24228b83a64803ccf00f9878d56a0306c4b76f17c4b5bdc1cd35358e04feb5", 0, SpentHeightEnum.UNSPENT, toBN(1100), "00143cbd2641a036e99579b5386b13a8c303f3b1cf0e")
                ]);
            }
        });

        const [tr,] = await wClient.transactionService.preparePaymentTransactionWithAdditionalFeeWallet(0, fundedAddress, fundedFeeAddress, targetAddress, toBN(1500), toBN(600));

        // Outputs should be 1500 (the amount), 1400 = 3500 - 1500 - 600 (amount remainder)
        expect(tr.outputs.length).to.be.eq(2);
        expect(tr.outputs.map(t => t.satoshis)).to.include.members([1500, 1400]);
    });
});