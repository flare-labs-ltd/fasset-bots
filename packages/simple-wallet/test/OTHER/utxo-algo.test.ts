import {
    BitcoinWalletConfig,
    BTC,
    logger,
} from "../../src";
import {addConsoleTransportForTests} from "../test-util/common_utils";
import {initializeTestMikroORM, ORM} from "../test-orm/mikro-orm.config";
import {UnprotectedDBWalletKeys} from "../test-orm/UnprotectedDBWalletKey";
import chaiAsPromised from "chai-as-promised";
import BN from "bn.js";
import {toBN} from "web3-utils";
import {expect, use} from "chai";
import {FeeStatus, TransactionFeeService} from "../../src/chain-clients/utxo/TransactionFeeService";
import { createTransactionEntityBase, createUTXO } from "../test-util/entity_utils";
import sinon from "sinon";
import { toBNExp } from "../../src/utils/bnutils";
import { BTC_DOGE_DEC_PLACES } from "../../src/utils/constants";
import * as utxoUtils from "../../src/chain-clients/utxo/UTXOUtils";
import {TransactionUTXOService} from "../../src/chain-clients/utxo/TransactionUTXOService";

use(chaiAsPromised);

const walletSecret = "wallet_secret";
const BTCMccConnectionTestInitial = {
    urls: [process.env.BTC_URL ?? ""],
    apiTokenKey: process.env.FLARE_API_PORTAL_KEY ?? "",
    inTestnet: true,
    walletSecret: walletSecret,
    minimumUTXOValue: toBN(100000),
};
let BTCMccConnectionTest: BitcoinWalletConfig;

const fundedAddress = "tb1qyghw9dla9vl0kutujnajvl6eyj0q2nmnlnx3j0";
const targetAddress = "tb1q8j7jvsdqxm5e27d48p4382xrq0emrncwfr35k4";

let wClient: BTC;
let testOrm: ORM;

describe("UTXO selection algorithm test", () => {

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
    });

    beforeEach(() => {
        sinon.restore();
        sinon.stub(TransactionUTXOService.prototype, "getNumberOfMempoolAncestors").resolves(0);
        sinon.stub(TransactionFeeService.prototype, "getFeePerKB").resolves(new BN(1000));
    });

    after(async () => {
        await testOrm.close();
    })

    it("It should fail if there's not enough UTXOs 1", async () => {
        sinon.stub(TransactionUTXOService.prototype, "filteredAndSortedMempoolUTXOs").resolves([
            createUTXO("ef99f95e95b18adfc44aae79722946e583677eb631a89a1b62fe0e275801a10c", 0, toBN(10020), "00143cbd2641a036e99579b5386b13a8c303f3b1cf0e"),
            createUTXO("2a6a5d5607492467e357140426f48e75e5ab3fa5fb625b6f201cce284f0dc55e", 0, toBN(1000), "00143cbd2641a036e99579b5386b13a8c303f3b1cf0e"),
            createUTXO("b895eab0cd280d1bb07897576e2edbdd7791d8b85bb64e28a9b86952faf8fdc2", 0, toBN(1000), "00143cbd2641a036e99579b5386b13a8c303f3b1cf0e"),
            createUTXO("0b24228b83a64803ccf00f9878d56a0306c4b76f17c4b5bdc1cd35358e04feb5", 0, toBN(1000), "00143cbd2641a036e99579b5386b13a8c303f3b1cf0e"),
        ]);

        await expect(wClient.transactionService.preparePaymentTransaction(0, fundedAddress, targetAddress, toBN(600), toBN(15000)))
            .to.eventually.be.rejectedWith(`Not enough UTXOs for creating transaction 0`);
    });

    it("It should fail if there's not enough UTXOs 2", async () => {
        sinon.stub(TransactionUTXOService.prototype, "filteredAndSortedMempoolUTXOs").resolves([
            createUTXO("ef99f95e95b18adfc44aae79722946e583677eb631a89a1b62fe0e275801a10c", 0, toBN(10020), "00143cbd2641a036e99579b5386b13a8c303f3b1cf0e"),
            createUTXO("2a6a5d5607492467e357140426f48e75e5ab3fa5fb625b6f201cce284f0dc55e", 0, toBN(1000), "00143cbd2641a036e99579b5386b13a8c303f3b1cf0e"),
            createUTXO("b895eab0cd280d1bb07897576e2edbdd7791d8b85bb64e28a9b86952faf8fdc2", 0, toBN(1000), "00143cbd2641a036e99579b5386b13a8c303f3b1cf0e"),
            createUTXO("0b24228b83a64803ccf00f9878d56a0306c4b76f17c4b5bdc1cd35358e04feb5", 0, toBN(1000), "00143cbd2641a036e99579b5386b13a8c303f3b1cf0e"),
        ]);

        await expect(wClient.transactionService.preparePaymentTransaction(0, fundedAddress, targetAddress, toBN(4000000)))
            .to.eventually.be.rejectedWith(`Not enough UTXOs for creating transaction 0`);
    });

    it("Should prioritize small UTXOs when fee status is LOW", async () => {
        sinon.stub(TransactionUTXOService.prototype, "filteredAndSortedMempoolUTXOs").resolves([
            createUTXO("ef99f95e95b18adfc44aae79722946e583677eb631a89a1b62fe0e275801a10c", 0, toBN(100200000), "00143cbd2641a036e99579b5386b13a8c303f3b1cf0e"),
            createUTXO("2a6a5d5607492467e357140426f48e75e5ab3fa5fb625b6f201cce284f0dc55e", 0, toBN(110000), "00143cbd2641a036e99579b5386b13a8c303f3b1cf0e"),
            createUTXO("b895eab0cd280d1bb07897576e2edbdd7791d8b85bb64e28a9b86952faf8fdc2", 0, toBN(110000), "00143cbd2641a036e99579b5386b13a8c303f3b1cf0e"),
            createUTXO("0b24228b83a64803ccf00f9878d56a0306c4b76f17c4b5bdc1cd35358e04feb5", 0, toBN(110200000), "00143cbd2641a036e99579b5386b13a8c303f3b1cf0e"),
            createUTXO("b8aac7ed190bf30610cd904e533eadabfee824054eb14a1e3a56cf1965b495d5", 0, toBN(140200000), "00143cbd2641a036e99579b5386b13a8c303f3b1cf0e"),
            createUTXO("52cf7492f717363cef1befcb7b4972adb053b65f2ec1763ac95c1e6312868dc6", 0, toBN(130200000), "00143cbd2641a036e99579b5386b13a8c303f3b1cf0e"),
            createUTXO("de3e8d9439325c51876e039cda60c35dc491e3c7c9045ae43759c011108993c6", 0, toBN(110000), "00143cbd2641a036e99579b5386b13a8c303f3b1cf0e"),
        ]);
        sinon.stub(TransactionFeeService.prototype, "getCurrentFeeStatus").resolves(FeeStatus.LOW);

        const [, utxos] = await wClient.transactionService.preparePaymentTransaction(0, fundedAddress, targetAddress, toBN(250000));
        expect(utxos.filter(t => t.value.lten(110000)).length).to.be.eq(3);
    });

    it("Should prioritize large UTXOs when fee status is HIGH", async () => {
        sinon.stub(TransactionUTXOService.prototype, "filteredAndSortedMempoolUTXOs").resolves([
            createUTXO("ef99f95e95b18adfc44aae79722946e583677eb631a89a1b62fe0e275801a10c", 0, toBN(100200000), "00143cbd2641a036e99579b5386b13a8c303f3b1cf0e"),
            createUTXO("2a6a5d5607492467e357140426f48e75e5ab3fa5fb625b6f201cce284f0dc55e", 0, toBN(900000), "00143cbd2641a036e99579b5386b13a8c303f3b1cf0e"),
            createUTXO("b895eab0cd280d1bb07897576e2edbdd7791d8b85bb64e28a9b86952faf8fdc2", 0, toBN(900000), "00143cbd2641a036e99579b5386b13a8c303f3b1cf0e"),
            createUTXO("0b24228b83a64803ccf00f9878d56a0306c4b76f17c4b5bdc1cd35358e04feb5", 0, toBN(110200000), "00143cbd2641a036e99579b5386b13a8c303f3b1cf0e"),
        ]);
        sinon.stub(TransactionFeeService.prototype, "getCurrentFeeStatus").resolves(FeeStatus.HIGH);

        const [, utxos] = await wClient.transactionService.preparePaymentTransaction(0, fundedAddress, targetAddress, toBN(1000000));
        expect(utxos.length).to.be.lte(2);
    });

    it("Should add small UTXOs for consolidation when fee status is LOW", async () => {
        sinon.stub(TransactionUTXOService.prototype, "filteredAndSortedMempoolUTXOs").resolves([
            createUTXO("ef99f95e95b18adfc44aae79722946e583677eb631a89a1b62fe0e275801a10c", 0, toBN(1002000), "00143cbd2641a036e99579b5386b13a8c303f3b1cf0e"),
            createUTXO("2a6a5d5607492467e357140426f48e75e5ab3fa5fb625b6f201cce284f0dc55e", 0, toBN(1000), "00143cbd2641a036e99579b5386b13a8c303f3b1cf0e"),
            createUTXO("b895eab0cd280d1bb07897576e2edbdd7791d8b85bb64e28a9b86952faf8fdc2", 0, toBN(3000), "00143cbd2641a036e99579b5386b13a8c303f3b1cf0e"),
            createUTXO("0b24228b83a64803ccf00f9878d56a0306c4b76f17c4b5bdc1cd35358e04feb5", 0, toBN(1004000), "00143cbd2641a036e99579b5386b13a8c303f3b1cf0e"),
            createUTXO("b8aac7ed190bf30610cd904e533eadabfee824054eb14a1e3a56cf1965b495d5", 0, toBN(1100200000), "00143cbd2641a036e99579b5386b13a8c303f3b1cf0e"),
            createUTXO("52cf7492f717363cef1befcb7b4972adb053b65f2ec1763ac95c1e6312868dc6", 0, toBN(1100200000), "00143cbd2641a036e99579b5386b13a8c303f3b1cf0e"),
        ]);
        sinon.stub(TransactionFeeService.prototype, "getCurrentFeeStatus").resolves(FeeStatus.LOW);

        const [, utxos] = await wClient.transactionService.preparePaymentTransaction(0, fundedAddress, targetAddress, toBN(2002000));
        expect(utxos.filter(t => t.value.lten(3000)).length).to.be.eq(2);
    });

    it("Should not add small UTXOs for consolidation when fee status is HIGH", async () => {
        sinon.stub(TransactionUTXOService.prototype, "filteredAndSortedMempoolUTXOs").resolves([
            createUTXO("ef99f95e95b18adfc44aae79722946e583677eb631a89a1b62fe0e275801a10c", 0, toBN(1002000), "00143cbd2641a036e99579b5386b13a8c303f3b1cf0e"),
            createUTXO("2a6a5d5607492467e357140426f48e75e5ab3fa5fb625b6f201cce284f0dc55e", 0, toBN(1000), "00143cbd2641a036e99579b5386b13a8c303f3b1cf0e"),
            createUTXO("b895eab0cd280d1bb07897576e2edbdd7791d8b85bb64e28a9b86952faf8fdc2", 0, toBN(3000), "00143cbd2641a036e99579b5386b13a8c303f3b1cf0e"),
            createUTXO("0b24228b83a64803ccf00f9878d56a0306c4b76f17c4b5bdc1cd35358e04feb5", 0, toBN(1004000), "00143cbd2641a036e99579b5386b13a8c303f3b1cf0e"),
            createUTXO("b8aac7ed190bf30610cd904e533eadabfee824054eb14a1e3a56cf1965b495d5", 0, toBN(1100200000), "00143cbd2641a036e99579b5386b13a8c303f3b1cf0e"),
            createUTXO("52cf7492f717363cef1befcb7b4972adb053b65f2ec1763ac95c1e6312868dc6", 0, toBN(1100200000), "00143cbd2641a036e99579b5386b13a8c303f3b1cf0e"),
        ]);
        sinon.stub(TransactionFeeService.prototype, "getCurrentFeeStatus").resolves(FeeStatus.HIGH);

        const [, utxos] = await wClient.transactionService.preparePaymentTransaction(0, fundedAddress, targetAddress, toBN(2002000));
        expect(utxos.filter(t => t.value.lten(3000)).length).to.be.eq(0);
    });

    it("When doing RBF original UTXOs should be returned also", async () => {
        sinon.stub(TransactionUTXOService.prototype, "filteredAndSortedMempoolUTXOs").resolves([
            createUTXO("0b24228b83a64803ccf00f9878d56a0306c4b76f17c4b5bdc1cd35358e04feb5", 0, toBN(1004000), "00143cbd2641a036e99579b5386b13a8c303f3b1cf0e"),
            createUTXO("b8aac7ed190bf30610cd904e533eadabfee824054eb14a1e3a56cf1965b495d5", 0, toBN(1100200000), "00143cbd2641a036e99579b5386b13a8c303f3b1cf0e"),
            createUTXO("52cf7492f717363cef1befcb7b4972adb053b65f2ec1763ac95c1e6312868dc6", 0, toBN(1100200000), "00143cbd2641a036e99579b5386b13a8c303f3b1cf0e"),
        ]);
        sinon.stub(TransactionFeeService.prototype, "getCurrentFeeStatus").resolves(FeeStatus.HIGH);

        const originalUTXOs = [
            createUTXO("ef99f95e95b18adfc44aae79722946e583677eb631a89a1b62fe0e275801a10c", 0, toBN(10020), "00143cbd2641a036e99579b5386b13a8c303f3b1cf0e"),
            createUTXO("2a6a5d5607492467e357140426f48e75e5ab3fa5fb625b6f201cce284f0dc55e", 0, toBN(1000), "00143cbd2641a036e99579b5386b13a8c303f3b1cf0e"),
            createUTXO("b895eab0cd280d1bb07897576e2edbdd7791d8b85bb64e28a9b86952faf8fdc2", 0, toBN(1000), "00143cbd2641a036e99579b5386b13a8c303f3b1cf0e"),
        ];

        const originalTxEnt = createTransactionEntityBase(0, fundedAddress, targetAddress, toBNExp(1, BTC_DOGE_DEC_PLACES));
        originalTxEnt.raw = JSON.stringify({
            inputs: originalUTXOs.map(t => ({
                prevTxId: t.transactionHash,
                outputIndex: t.position,
                sequenceNumber: 0,
                script: t.script,
                scriptString: t.script,
                output: {
                    satoshis: t.value,
                    script: t.script
                },
            })),
        });
        originalTxEnt.size = 208;

        const [, newUTXOs] = await wClient.transactionService.preparePaymentTransaction(0, fundedAddress, targetAddress, toBN(2002000), undefined, undefined, originalTxEnt);

        expect(newUTXOs.map(t => t.transactionHash)).to.include.all.members(originalUTXOs.map(t => t.transactionHash));
        expect(newUTXOs.length).to.be.gt(originalUTXOs.length);
    });

    // TODO - fix
    it.skip("When doing RBF only confirmed UTXOs can be used", async () => {
        sinon.stub(TransactionUTXOService.prototype, "filteredAndSortedMempoolUTXOs").resolves([
            createUTXO("0b24228b83a64803ccf00f9878d56a0306c4b76f17c4b5bdc1cd35358e04feb5", 0, toBN(12000), "00143cbd2641a036e99579b5386b13a8c303f3b1cf0e"),
            createUTXO("b8aac7ed190bf30610cd904e533eadabfee824054eb14a1e3a56cf1965b495d5", 0, toBN(10000), "00143cbd2641a036e99579b5386b13a8c303f3b1cf0e"),
            createUTXO("2a6a5d5607492467e357140426f48e75e5ab3fa5fb625b6f201cce284f0dc55e", 0, toBN(100000), "00143cbd2641a036e99579b5386b13a8c303f3b1cf0e", false),
            createUTXO("b895eab0cd280d1bb07897576e2edbdd7791d8b85bb64e28a9b86952faf8fdc2", 0, toBN(1500000), "00143cbd2641a036e99579b5386b13a8c303f3b1cf0e", false)
        ]);
        sinon.stub(TransactionFeeService.prototype, "getCurrentFeeStatus").resolves(FeeStatus.HIGH);

        const originalUTXOs = [
            createUTXO("52cf7492f717363cef1befcb7b4972adb053b65f2ec1763ac95c1e6312868dc6", 0, toBN(10000), "00143cbd2641a036e99579b5386b13a8c303f3b1cf0e"),
            createUTXO("ef99f95e95b18adfc44aae79722946e583677eb631a89a1b62fe0e275801a10c", 0, toBN(20000), "00143cbd2641a036e99579b5386b13a8c303f3b1cf0e"),
        ];

        const originalTxEnt = createTransactionEntityBase(0, fundedAddress, targetAddress, toBNExp(1, BTC_DOGE_DEC_PLACES));
        originalTxEnt.raw = JSON.stringify({
            inputs: originalUTXOs.map(t => ({
                prevTxId: t.transactionHash,
                outputIndex: t.position,
                sequenceNumber: 0,
                script: t.script,
                scriptString: t.script,
                output: {
                    satoshis: t.value,
                    script: t.script
                },
            })),
        });

        const [, newUTXOs] = await wClient.transactionService.preparePaymentTransaction(0, fundedAddress, targetAddress, toBN(42000), undefined, undefined, originalTxEnt);

        expect(newUTXOs.map(t => t.transactionHash)).to.include.all.members(originalUTXOs.map(t => t.transactionHash));
        expect(newUTXOs.length).to.be.gt(originalUTXOs.length);
        expect(newUTXOs.filter(t => t.confirmed || originalUTXOs.filter(u => u.transactionHash === t.transactionHash)).length).to.be.eq(newUTXOs.length);
    });

    it("If a fixed fee is set it should be obliged", async () => {
        sinon.stub(TransactionUTXOService.prototype, "filteredAndSortedMempoolUTXOs").resolves([
            createUTXO("ef99f95e95b18adfc44aae79722946e583677eb631a89a1b62fe0e275801a10c", 0, toBN(100200000), "00143cbd2641a036e99579b5386b13a8c303f3b1cf0e"),
            createUTXO("2a6a5d5607492467e357140426f48e75e5ab3fa5fb625b6f201cce284f0dc55e", 0, toBN(900000), "00143cbd2641a036e99579b5386b13a8c303f3b1cf0e"),
            createUTXO("b895eab0cd280d1bb07897576e2edbdd7791d8b85bb64e28a9b86952faf8fdc2", 0, toBN(900000), "00143cbd2641a036e99579b5386b13a8c303f3b1cf0e"),
            createUTXO("0b24228b83a64803ccf00f9878d56a0306c4b76f17c4b5bdc1cd35358e04feb5", 0, toBN(110200000), "00143cbd2641a036e99579b5386b13a8c303f3b1cf0e"),
        ]);
        sinon.stub(TransactionFeeService.prototype, "getCurrentFeeStatus").resolves(FeeStatus.HIGH);

        const feeInSatoshi = toBN(500000);
        const [tr,] = await wClient.transactionService.preparePaymentTransaction(0, fundedAddress, targetAddress, toBN(1000000), feeInSatoshi);
        expect(tr.getFee()).to.be.eq(feeInSatoshi.toNumber());
    });

    it("Delete account transaction", async () => {
        const utxos = [
            createUTXO("0b24228b83a64803ccf00f9878d56a0306c4b76f17c4b5bdc1cd35358e04feb5", 0, toBN(1000), "00143cbd2641a036e99579b5386b13a8c303f3b1cf0e"),
            createUTXO("b8aac7ed190bf30610cd904e533eadabfee824054eb14a1e3a56cf1965b495d5", 0, toBN(2000), "00143cbd2641a036e99579b5386b13a8c303f3b1cf0e"),
            createUTXO("52cf7492f717363cef1befcb7b4972adb053b65f2ec1763ac95c1e6312868dc6", 0, toBN(5000), "00143cbd2641a036e99579b5386b13a8c303f3b1cf0e"),
        ];
        sinon.stub(TransactionUTXOService.prototype, "filteredAndSortedMempoolUTXOs").resolves(utxos);
        sinon.stub(TransactionUTXOService.prototype, "fetchUTXOs").resolves(utxos);
        sinon.stub(utxoUtils, "getAccountBalance").resolves(new BN(8000));

        const [tr] = await wClient.transactionService.preparePaymentTransaction(0, fundedAddress, targetAddress, null);
        expect(tr.outputs.length).to.be.eq(1);
        expect(tr.outputs[0].satoshis).to.be.eq(7755); // 3 inputs + 1 output = 245 vBytes
    });

    it("If UTXO has more than 24 ancestors, it should be skipped", async () => {
        sinon.restore();
        sinon.stub(TransactionUTXOService.prototype, "filteredAndSortedMempoolUTXOs").resolves([
            createUTXO("ef99f95e95b18adfc44aae79722946e583677eb631a89a1b62fe0e275801a10c", 0, toBN(100200000), "00143cbd2641a036e99579b5386b13a8c303f3b1cf0e"),
            createUTXO("2a6a5d5607492467e357140426f48e75e5ab3fa5fb625b6f201cce284f0dc55e", 0, toBN(900000), "00143cbd2641a036e99579b5386b13a8c303f3b1cf0e"),
            createUTXO("b895eab0cd280d1bb07897576e2edbdd7791d8b85bb64e28a9b86952faf8fdc2", 0, toBN(900000), "00143cbd2641a036e99579b5386b13a8c303f3b1cf0e"),
            createUTXO("0b24228b83a64803ccf00f9878d56a0306c4b76f17c4b5bdc1cd35358e04feb5", 0, toBN(110200000), "00143cbd2641a036e99579b5386b13a8c303f3b1cf0e"),
        ]);
        sinon.stub(TransactionFeeService.prototype, "getCurrentFeeStatus").resolves(FeeStatus.LOW);
        sinon.stub(TransactionUTXOService.prototype, "getNumberOfMempoolAncestors").callsFake((txHash: string) => {
            if (txHash !== "ef99f95e95b18adfc44aae79722946e583677eb631a89a1b62fe0e275801a10c") {
                return Promise.resolve(25);
            } else {
                return Promise.resolve(0);
            }
        });

        const [, utxos] = await wClient.transactionService.preparePaymentTransaction(0, fundedAddress, targetAddress, toBN(1000000));
        expect(utxos.length).to.be.eq(1);
    });

    it("If fee status is HIGH it should use minimal transactions too if ones greater than limit are non-existent", async () => {
        const minimumUTXOValue = wClient.transactionUTXOService.minimumUTXOValue.divn(2);
        sinon.stub(TransactionUTXOService.prototype, "filteredAndSortedMempoolUTXOs").resolves([
            createUTXO("ef99f95e95b18adfc44aae79722946e583677eb631a89a1b62fe0e275801a10c", 0, minimumUTXOValue, "00143cbd2641a036e99579b5386b13a8c303f3b1cf0e"),
            createUTXO("2a6a5d5607492467e357140426f48e75e5ab3fa5fb625b6f201cce284f0dc55e", 0, minimumUTXOValue, "00143cbd2641a036e99579b5386b13a8c303f3b1cf0e"),
            createUTXO("b895eab0cd280d1bb07897576e2edbdd7791d8b85bb64e28a9b86952faf8fdc2", 0, minimumUTXOValue, "00143cbd2641a036e99579b5386b13a8c303f3b1cf0e"),
            createUTXO("0b24228b83a64803ccf00f9878d56a0306c4b76f17c4b5bdc1cd35358e04feb5", 0, minimumUTXOValue, "00143cbd2641a036e99579b5386b13a8c303f3b1cf0e"),
        ]);
        sinon.stub(TransactionFeeService.prototype, "getCurrentFeeStatus").resolves(FeeStatus.HIGH);
        const [, utxos] = await wClient.transactionService.preparePaymentTransaction(0, fundedAddress, targetAddress, minimumUTXOValue.muln(3));
        expect(utxos.length).to.be.eq(4);
    });

    it("If fee status is HIGH it should use minimal transactions too if ones greater than limit are non-existent 2", async () => {
        const minimumUTXOValue = wClient.transactionUTXOService.minimumUTXOValue.divn(2);
        sinon.stub(TransactionUTXOService.prototype, "filteredAndSortedMempoolUTXOs").resolves([
            createUTXO("ef99f95e95b18adfc44aae79722946e583677eb631a89a1b62fe0e275801a10c", 0, minimumUTXOValue, "00143cbd2641a036e99579b5386b13a8c303f3b1cf0e"),
            createUTXO("2a6a5d5607492467e357140426f48e75e5ab3fa5fb625b6f201cce284f0dc55e", 0, minimumUTXOValue, "00143cbd2641a036e99579b5386b13a8c303f3b1cf0e"),
            createUTXO("b895eab0cd280d1bb07897576e2edbdd7791d8b85bb64e28a9b86952faf8fdc2", 0, minimumUTXOValue.muln(1.5), "00143cbd2641a036e99579b5386b13a8c303f3b1cf0e"),
        ]);
        sinon.stub(TransactionFeeService.prototype, "getCurrentFeeStatus").resolves(FeeStatus.HIGH);
        const [, utxos] = await wClient.transactionService.preparePaymentTransaction(0, fundedAddress, targetAddress, minimumUTXOValue.muln(3));
        expect(utxos.length).to.be.eq(3);
    });

    it("If fee status is HIGH it should keep only the big UTXOs", async () => {
        const minimumUTXOValue = wClient.transactionUTXOService.minimumUTXOValue;
        const utxos = [
            createUTXO("0b24228b83a64803ccf00f9878d56a0306c4b76f17c4b5bdc1cd35358e04feb5", 0, minimumUTXOValue.muln(1.5), "00143cbd2641a036e99579b5386b13a8c303f3b1cf0e"),
            createUTXO("b8aac7ed190bf30610cd904e533eadabfee824054eb14a1e3a56cf1965b495d5", 0, minimumUTXOValue.muln(1.5), "00143cbd2641a036e99579b5386b13a8c303f3b1cf0e"),
            createUTXO("52cf7492f717363cef1befcb7b4972adb053b65f2ec1763ac95c1e6312868dc6", 0, minimumUTXOValue.muln(1.5), "00143cbd2641a036e99579b5386b13a8c303f3b1cf0e"),
            createUTXO("0b24228b83a64803ccf00f9878d56a0306c4b76f17c4b5bdc1cd35358e04feb5", 0, minimumUTXOValue.divn(2), "00143cbd2641a036e99579b5386b13a8c303f3b1cf0e"),
            createUTXO("b8aac7ed190bf30610cd904e533eadabfee824054eb14a1e3a56cf1965b495d5", 0, minimumUTXOValue.divn(2), "00143cbd2641a036e99579b5386b13a8c303f3b1cf0e"),
        ];
        sinon.stub(TransactionUTXOService.prototype, "filteredAndSortedMempoolUTXOs").resolves(utxos);
        sinon.stub(utxoUtils, "getAccountBalance").resolves(new BN(8000));

        sinon.stub(TransactionFeeService.prototype, "getCurrentFeeStatus").resolves(FeeStatus.HIGH);
        const [, trUTXOs] = await wClient.transactionService.preparePaymentTransaction(0, fundedAddress, targetAddress, minimumUTXOValue.muln(3));
        expect(trUTXOs.filter(t => t.value.lte(minimumUTXOValue)).length).to.be.eq(0);
    });
});

const utxoList = [
    createUTXO("ef99f95e95b18adfc44aae79722946e583677eb631a89a1b62fe0e275801a10c", 0, toBN(10020), "00143cbd2641a036e99579b5386b13a8c303f3b1cf0e"),
    createUTXO("2a6a5d5607492467e357140426f48e75e5ab3fa5fb625b6f201cce284f0dc55e", 0, toBN(1000), "00143cbd2641a036e99579b5386b13a8c303f3b1cf0e"),
    createUTXO("b895eab0cd280d1bb07897576e2edbdd7791d8b85bb64e28a9b86952faf8fdc2", 0, toBN(1000), "00143cbd2641a036e99579b5386b13a8c303f3b1cf0e"),
    createUTXO("0b24228b83a64803ccf00f9878d56a0306c4b76f17c4b5bdc1cd35358e04feb5", 0, toBN(1000), "00143cbd2641a036e99579b5386b13a8c303f3b1cf0e"),
    createUTXO("b8aac7ed190bf30610cd904e533eadabfee824054eb14a1e3a56cf1965b495d5", 0, toBN(1000), "00143cbd2641a036e99579b5386b13a8c303f3b1cf0e"),
    createUTXO("52cf7492f717363cef1befcb7b4972adb053b65f2ec1763ac95c1e6312868dc6", 0, toBN(1000), "00143cbd2641a036e99579b5386b13a8c303f3b1cf0e"),
    createUTXO("de3e8d9439325c51876e039cda60c35dc491e3c7c9045ae43759c011108993c6", 0, toBN(1000), "00143cbd2641a036e99579b5386b13a8c303f3b1cf0e"),
    createUTXO("1a31d01de95dc4346084c387731701d7d09dec86bcceefcf6a048e18ab2a4c7b", 0, toBN(1000), "00143cbd2641a036e99579b5386b13a8c303f3b1cf0e"),
    createUTXO("eb4806e9b879ef4431edf322f1b5cb3b454e79003bbeaa1d2b5000d20719fdbc", 0, toBN(1000), "00143cbd2641a036e99579b5386b13a8c303f3b1cf0e"),
    createUTXO("f165d22a1a63dd45921c597cf77a51224db146c60b873f81866ed8d352eca54c", 0, toBN(1000), "00143cbd2641a036e99579b5386b13a8c303f3b1cf0e"),
    createUTXO("281219ee58c3cc5dfb14ba1e62ac306dab6ad75a1c63909d257a5bcc7427af21", 0, toBN(1000), "00143cbd2641a036e99579b5386b13a8c303f3b1cf0e"),
    createUTXO("e71687c5b4f26a28800334f4d33ef17b6a2e3cb8549af120649e4898659e1e62", 0, toBN(1000), "00143cbd2641a036e99579b5386b13a8c303f3b1cf0e"),
    createUTXO("6c92762544368c03c3c609cd1edcb9dd4b50759a9e864a67555806ba42e1851c", 0, toBN(1000), "00143cbd2641a036e99579b5386b13a8c303f3b1cf0e"),
];
