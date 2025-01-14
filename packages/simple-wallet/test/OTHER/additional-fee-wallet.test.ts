import sinon from "sinon";
import { BitcoinWalletConfig, BTC, logger } from "../../src";
import { toBN } from "web3-utils";
import { addConsoleTransportForTests, createNote } from "../test-util/common_utils";
import config, { initializeTestMikroORM, ORM } from "../test-orm/mikro-orm.config";
import { UnprotectedDBWalletKeys } from "../test-orm/UnprotectedDBWalletKey";
import { FeeStatus, TransactionFeeService } from "../../src/chain-clients/utxo/TransactionFeeService";
import { createAndPersistTransactionEntity, createUTXO } from "../test-util/entity_utils";
import { expect } from "chai";
import { TransactionUTXOService } from "../../src/chain-clients/utxo/TransactionUTXOService";
import { getMinAmountToSend, getRelayFeePerKB } from "../../src/chain-clients/utxo/UTXOUtils";

const walletSecret = "wallet_secret";
const amountToSendSatoshi = toBN(10000);
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

describe("Unit test for paying fees from additional wallet", () => {
    const feePerKB = toBN(1000);

    before(async () => {
        addConsoleTransportForTests(logger);
        testOrm = await initializeTestMikroORM({...config, dbName: "unit-test-db"});
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
        sinon.stub(TransactionFeeService.prototype, "getCurrentFeeStatus").resolves(FeeStatus.LOW);
        sinon.stub(TransactionUTXOService.prototype, "getNumberOfMempoolAncestors").resolves(0);
    });

    after(async () => {
        await testOrm.close();
    })

    it("It should create transaction from 'base' wallet even if the 'fee' wallet doesn't have enough funds", async () => {
        sinon.stub(TransactionUTXOService.prototype, "filteredAndSortedMempoolUTXOs").callsFake((source) => {
            if (source === fundedAddress) {
                return Promise.resolve([
                    createUTXO("ef99f95e95b18adfc44aae79722946e583677eb631a89a1b62fe0e275801a10c", 0, toBN(10020), "00143cbd2641a036e99579b5386b13a8c303f3b1cf0e"),
                    createUTXO("2a6a5d5607492467e357140426f48e75e5ab3fa5fb625b6f201cce284f0dc55e", 0, toBN(1000), "00143cbd2641a036e99579b5386b13a8c303f3b1cf0e"),
                    createUTXO("b895eab0cd280d1bb07897576e2edbdd7791d8b85bb64e28a9b86952faf8fdc2", 0, toBN(1000), "00143cbd2641a036e99579b5386b13a8c303f3b1cf0e"),
                ]);
            } else {
                return Promise.resolve([
                    createUTXO("0b24228b83a64803ccf00f9878d56a0306c4b76f17c4b5bdc1cd35358e04feb5", 0, toBN(1000), "00143cbd2641a036e99579b5386b13a8c303f3b1cf0e")
                ]);
            }
        });

        const fee = 2000;
        const [tr, utxos] = await wClient.transactionService.preparePaymentTransactionWithAdditionalFeeWallet(0, fundedAddress, fundedFeeAddress, targetAddress, toBN(1500), false, feePerKB, toBN(fee));
        const ogUTXOs = await wClient.transactionUTXOService.filteredAndSortedMempoolUTXOs(fundedAddress);

        expect(ogUTXOs.map(t => t.transactionHash)).to.have.members(utxos.map(t => t.transactionHash));
        expect(tr.getFee()).to.be.eq(fee);
    });

    it("If 'fee' wallet has enough funds fee should be covered from it, remainder should be returned", async () => {
        sinon.stub(TransactionUTXOService.prototype, "filteredAndSortedMempoolUTXOs").callsFake((source) => {
            if (source === fundedAddress) {
                return Promise.resolve([
                    createUTXO("2a6a5d5607492467e357140426f48e75e5ab3fa5fb625b6f201cce284f0dc55e", 0, toBN(1000), "00143cbd2641a036e99579b5386b13a8c303f3b1cf0e"),
                    createUTXO("b895eab0cd280d1bb07897576e2edbdd7791d8b85bb64e28a9b86952faf8fdc2", 0, toBN(1400), "00143cbd2641a036e99579b5386b13a8c303f3b1cf0e"),
                ]);
            } else {
                return Promise.resolve([
                    createUTXO("0b24228b83a64803ccf00f9878d56a0306c4b76f17c4b5bdc1cd35358e04feb5", 0, toBN(3000), "00143cbd2641a036e99579b5386b13a8c303f3b1cf0e")
                ]);
            }
        });

        const fee = 1000;
        const [tr,] = await wClient.transactionService.preparePaymentTransactionWithAdditionalFeeWallet(0, fundedAddress, fundedFeeAddress, targetAddress, toBN(1500), false, feePerKB, toBN(fee));

        // It should output 1500 (the amount), 2000 (fee remainder), 900 (remainder of amount)
        expect(tr.outputs.map(t => t.satoshis)).to.include.all.members([1500, 2000, 900]);
        expect(tr.outputs.length).to.be.eq(3);
        expect(tr.getFee()).to.be.eq(fee);
    });

    it("If 'fee' wallet has enough funds fee should be covered from it, remainder should be returned only if it's greater than dust 1", async () => {
        sinon.stub(TransactionUTXOService.prototype, "filteredAndSortedMempoolUTXOs").callsFake((source) => {
            if (source === fundedAddress) {
                return Promise.resolve([
                    createUTXO("2a6a5d5607492467e357140426f48e75e5ab3fa5fb625b6f201cce284f0dc55e", 0, toBN(2000), "00143cbd2641a036e99579b5386b13a8c303f3b1cf0e"),
                    createUTXO("b895eab0cd280d1bb07897576e2edbdd7791d8b85bb64e28a9b86952faf8fdc2", 0, toBN(2400), "00143cbd2641a036e99579b5386b13a8c303f3b1cf0e"),
                ]);
            } else {
                return Promise.resolve([
                    createUTXO("0b24228b83a64803ccf00f9878d56a0306c4b76f17c4b5bdc1cd35358e04feb5", 0, toBN(2000), "00143cbd2641a036e99579b5386b13a8c303f3b1cf0e")
                ]);
            }
        });

        const fee = 1500;
        const [tr,] = await wClient.transactionService.preparePaymentTransactionWithAdditionalFeeWallet(0, fundedAddress, fundedFeeAddress, targetAddress, toBN(1500), false, feePerKB, toBN(fee));

        // It should output 1500 (the amount) and 3400 = 6400 (sum of inputs) - 1500 (fee) - 1500 (the amount)
        expect(tr.outputs.length).to.be.eq(2);
        expect(tr.outputs.map(t => t.satoshis)).to.include.all.members([1500, 3400]);
        expect(tr.getFee()).to.be.eq(fee);
    });

    it("If 'fee' wallet has enough funds fee should be covered from it, fee should be covered from it if it's greater than dust 2", async () => {
        sinon.stub(TransactionUTXOService.prototype, "filteredAndSortedMempoolUTXOs").callsFake((source) => {
            if (source === fundedAddress) {
                return Promise.resolve([
                    createUTXO("2a6a5d5607492467e357140426f48e75e5ab3fa5fb625b6f201cce284f0dc55e", 0, toBN(1000), "00143cbd2641a036e99579b5386b13a8c303f3b1cf0e"),
                    createUTXO("b895eab0cd280d1bb07897576e2edbdd7791d8b85bb64e28a9b86952faf8fdc2", 0, toBN(1400), "00143cbd2641a036e99579b5386b13a8c303f3b1cf0e"),
                ]);
            } else {
                return Promise.resolve([
                    createUTXO("0b24228b83a64803ccf00f9878d56a0306c4b76f17c4b5bdc1cd35358e04feb5", 0, toBN(2000), "00143cbd2641a036e99579b5386b13a8c303f3b1cf0e")
                ]);
            }
        });

        const [tr,] = await wClient.transactionService.preparePaymentTransactionWithAdditionalFeeWallet(0, fundedAddress, fundedFeeAddress, targetAddress, toBN(1500), false, feePerKB);

        // Transaction should have 3 inputs and 3 ouputs => size is 208.5 vB => fee is 208 (since it's 1000sat/vB)
        // Outputs should be 1500 (the amount), 692 (amount remainder)
        expect(tr.outputs.length).to.be.eq(2);
        expect(tr.inputs.length).to.be.eq(2);
        expect(tr.inputs.filter(t => t.script.toHex() !== "0b24228b83a64803ccf00f9878d56a0306c4b76f17c4b5bdc1cd35358e04feb5").length).to.be.eq(2);
        expect(tr.outputs.map(t => t.satoshis)).to.include.members([1500, 692]);
    });

    it("If 'fee' wallet has enough funds fee should be covered from it if fee is greater than dust", async () => {
        sinon.stub(TransactionUTXOService.prototype, "filteredAndSortedMempoolUTXOs").callsFake((source) => {
            if (source === fundedAddress) {
                return Promise.resolve([
                    createUTXO("2a6a5d5607492467e357140426f48e75e5ab3fa5fb625b6f201cce284f0dc55e", 0, toBN(1000), "00143cbd2641a036e99579b5386b13a8c303f3b1cf0e"),
                    createUTXO("b895eab0cd280d1bb07897576e2edbdd7791d8b85bb64e28a9b86952faf8fdc2", 0, toBN(1400), "00143cbd2641a036e99579b5386b13a8c303f3b1cf0e"),
                ]);
            } else {
                return Promise.resolve([
                    createUTXO("0b24228b83a64803ccf00f9878d56a0306c4b76f17c4b5bdc1cd35358e04feb5", 0, toBN(600), "00143cbd2641a036e99579b5386b13a8c303f3b1cf0e")
                ]);
            }
        });

        const [tr,] = await wClient.transactionService.preparePaymentTransactionWithAdditionalFeeWallet(0, fundedAddress, fundedFeeAddress, targetAddress, toBN(1500), false, feePerKB);

        // Transaction should have 2 inputs and 2 ouputs => size is 208.5 vB => fee is 208 (since it's 1000sat/vB)
        // Outputs should be 1500 (the amount), 692 = 2400 - 1500 - 208 (amount remainder)
        expect(tr.inputs.filter(t => t.prevTxId.toString('hex') != "0b24228b83a64803ccf00f9878d56a0306c4b76f17c4b5bdc1cd35358e04feb5").length).to.be.eq(tr.inputs.length);
        expect(tr.outputs.length).to.be.eq(2);
        expect(tr.outputs.map(t => t.satoshis)).to.include.members([1500, 692]);
    });

    it("If 'fee' wallet has enough funds fee should be covered from it, remainder should be returned only if it's greater than dust", async () => {
        sinon.stub(TransactionUTXOService.prototype, "filteredAndSortedMempoolUTXOs").callsFake((source) => {
            if (source === fundedAddress) {
                return Promise.resolve([
                    createUTXO("2a6a5d5607492467e357140426f48e75e5ab3fa5fb625b6f201cce284f0dc55e", 0, toBN(1000), "00143cbd2641a036e99579b5386b13a8c303f3b1cf0e"),
                    createUTXO("b895eab0cd280d1bb07897576e2edbdd7791d8b85bb64e28a9b86952faf8fdc2", 0, toBN(2400), "00143cbd2641a036e99579b5386b13a8c303f3b1cf0e"),
                ]);
            } else {
                return Promise.resolve([
                    createUTXO("0b24228b83a64803ccf00f9878d56a0306c4b76f17c4b5bdc1cd35358e04feb5", 0, toBN(1100), "00143cbd2641a036e99579b5386b13a8c303f3b1cf0e")
                ]);
            }
        });

        const [tr,] = await wClient.transactionService.preparePaymentTransactionWithAdditionalFeeWallet(0, fundedAddress, fundedFeeAddress, targetAddress, toBN(1500), false, feePerKB, toBN(600));

        // Outputs should be 1500 (the amount), 2400 = 1000 + 2400 + 1100 - 1500 - 600 (amount remainder)
        expect(tr.outputs.length).to.be.eq(2);
        expect(tr.outputs.map(t => t.satoshis)).to.include.members([1500, 2400]);
    });

    it("Free underlying: Should create transaction with specified amount and fee", async () => {
        sinon.stub(TransactionUTXOService.prototype, "filteredAndSortedMempoolUTXOs").resolves([
            createUTXO("ef99f95e95b18adfc44aae79722946e583677eb631a89a1b62fe0e275801a10c", 0, toBN(1000), "00143cbd2641a036e99579b5386b13a8c303f3b1cf0e"),
            createUTXO("2a6a5d5607492467e357140426f48e75e5ab3fa5fb625b6f201cce284f0dc55e", 0, toBN(1000), "00143cbd2641a036e99579b5386b13a8c303f3b1cf0e"),
            createUTXO("b895eab0cd280d1bb07897576e2edbdd7791d8b85bb64e28a9b86952faf8fdc2", 0, toBN(1000), "00143cbd2641a036e99579b5386b13a8c303f3b1cf0e"),
        ]);

        const [tr,] = await wClient.transactionService.prepareFreeUnderlyingPaymentTransactionWithSingleWallet(0, fundedAddress, targetAddress, toBN(1500), feePerKB, toBN(600));
        expect(tr.outputs.length).to.be.eq(2);
        expect(tr.outputs.map(t => t.satoshis)).to.include.members([1500, 900]);
        expect(tr.getFee()).to.be.eq(600);
    });

    it("Free underlying: Should create transaction with specified amount and unspecified fee", async () => {
        sinon.stub(TransactionUTXOService.prototype, "filteredAndSortedMempoolUTXOs").resolves([
            createUTXO("ef99f95e95b18adfc44aae79722946e583677eb631a89a1b62fe0e275801a10c", 0, toBN(1000), "00143cbd2641a036e99579b5386b13a8c303f3b1cf0e"),
            createUTXO("2a6a5d5607492467e357140426f48e75e5ab3fa5fb625b6f201cce284f0dc55e", 0, toBN(1000), "00143cbd2641a036e99579b5386b13a8c303f3b1cf0e"),
            createUTXO("b895eab0cd280d1bb07897576e2edbdd7791d8b85bb64e28a9b86952faf8fdc2", 0, toBN(1000), "00143cbd2641a036e99579b5386b13a8c303f3b1cf0e"),
        ]);

        // Transaction should have 3 inputs and 2 ouputs => size is 276.5 vB => fee is 276 (since it's 1000sat/vB)
        const [tr,] = await wClient.transactionService.prepareFreeUnderlyingPaymentTransactionWithSingleWallet(0, fundedAddress, targetAddress, toBN(2100), feePerKB);
        expect(tr.outputs.length).to.be.eq(2);
        // Since the fee is not specified the amount is reduced by fee in order to cover it
        expect(tr.outputs.map(t => t.satoshis)).to.include.members([2100 - 276, 3000 - 2100]);
        expect(tr.getFee()).to.be.eq(276);
    });

    it("RBF fee per byte should be >= original fee byte + relay fee per byte", async () => {
        sinon.stub(TransactionUTXOService.prototype, "filteredAndSortedMempoolUTXOs").callsFake((source) => {
            return Promise.resolve([
                createUTXO("ef99f95e95b18adfc44aae79722946e583677eb631a89a1b62fe0e275801a10c", 0, toBN(15000), "00143cbd2641a036e99579b5386b13a8c303f3b1cf0e"),
                createUTXO("2a6a5d5607492467e357140426f48e75e5ab3fa5fb625b6f201cce284f0dc55e", 0, toBN(10000), "00143cbd2641a036e99579b5386b13a8c303f3b1cf0e"),
            ]);
        });

        const txEnt = await createAndPersistTransactionEntity(wClient.rootEm, wClient.chainType, fundedAddress, targetAddress, amountToSendSatoshi);
        const mempoolUTXOs = await wClient.transactionUTXOService.filteredAndSortedMempoolUTXOs(fundedAddress);
        const inputs = mempoolUTXOs.slice(0, 3);

        txEnt.raw = JSON.stringify({
            inputs: inputs.map(t => ({
                prevTxId: t.transactionHash,
                outputIndex: t.position,
                sequenceNumber: 0,
                script: "",
                scriptString: "",
                output: {
                    satoshis: t.value.toNumber(),
                    script: t.script
                },
            })),
        });

        const feeInSatoshi = toBN(307);
        const [tr,] = await wClient.transactionService.preparePaymentTransactionWithSingleWallet(2, fundedAddress, targetAddress, getMinAmountToSend(wClient.chainType), false, feePerKB, feeInSatoshi, undefined, undefined, txEnt);
        const vSize = await wClient.transactionService.calculateTransactionSize(tr, fundedAddress);
        const relayFeePerB = getRelayFeePerKB(wClient.chainType).muln(wClient.transactionFeeService.feeIncrease).divn(1000);
        expect(toBN(tr.getFee()).sub(toBN(vSize).mul(relayFeePerB)).toNumber()).to.be.gte(feeInSatoshi.toNumber());
        expect(tr.inputs.map(t => t.prevTxId.toString('hex'))).to.have.members(inputs.map(t => t.transactionHash));
    });

    it("Should use additional UTXOs to cover relay fee", async () => {
        sinon.restore();
        sinon.stub(TransactionUTXOService.prototype, "filteredAndSortedMempoolUTXOs").callsFake((source) => {
            return Promise.resolve([
                createUTXO("b895eab0cd280d1bb07897576e2edbdd7791d8b85bb64e28a9b86952faf8fdc2", 0, toBN(10000), "00143cbd2641a036e99579b5386b13a8c303f3b1cf0e",),
            ]);
        });
        sinon.stub(TransactionFeeService.prototype, "getCurrentFeeStatus").resolves(FeeStatus.LOW);

        const txEnt = await createAndPersistTransactionEntity(wClient.rootEm, wClient.chainType, fundedAddress, targetAddress, amountToSendSatoshi);
        const inputs = [
            createUTXO("ef99f95e95b18adfc44aae79722946e583677eb631a89a1b62fe0e275801a10c", 0, toBN(1500), "00143cbd2641a036e99579b5386b13a8c303f3b1cf0e"),
            createUTXO("2a6a5d5607492467e357140426f48e75e5ab3fa5fb625b6f201cce284f0dc55e", 0, toBN(10000), "00143cbd2641a036e99579b5386b13a8c303f3b1cf0e")
        ];

        txEnt.raw = JSON.stringify({
            inputs: inputs.map(t => ({
                prevTxId: t.transactionHash,
                outputIndex: t.position,
                sequenceNumber: 0,
                script: "",
                scriptString: "",
                output: {
                    satoshis: t.value.toNumber(),
                    script: t.script
                },
            })),
        });

        const feeInSatoshi = toBN(1400);
        const [tr,] = await wClient.transactionService.preparePaymentTransactionWithSingleWallet(2, fundedAddress, targetAddress, getMinAmountToSend(wClient.chainType), false, feePerKB, feeInSatoshi, undefined, undefined, txEnt);
        const vSize = await wClient.transactionService.calculateTransactionSize(tr, fundedAddress);
        const relayFeePerB = getRelayFeePerKB(wClient.chainType).muln(wClient.transactionFeeService.feeIncrease).divn(1000);
        expect(toBN(tr.getFee()).sub(toBN(vSize).mul(relayFeePerB)).toNumber()).to.be.gte(feeInSatoshi.toNumber());
        expect(tr.inputs.length).to.be.gt(inputs.length);
    });
});
