import {
    BitcoinWalletConfig,
    BTC,
    logger,
    SpentHeightEnum, TransactionEntity,
    UTXOEntity,
} from "../../src";
import { addConsoleTransportForTests, resetMonitoringOnForceExit } from "../test-util/util";
import { initializeTestMikroORM, ORM } from "../test-orm/mikro-orm.config";
import { UnprotectedDBWalletKeys } from "../test-orm/UnprotectedDBWalletKey";
import chaiAsPromised from "chai-as-promised";
import BN from "bn.js";
import { toBN } from "web3-utils";
import * as dbutils from "../../src/db/dbutils";
import * as utxoutils from "../../src/chain-clients/utxo/UTXOUtils"
import { ServiceRepository } from "../../src/ServiceRepository";
import { TransactionService } from "../../src/chain-clients/utxo/TransactionService";
import { expect, use } from "chai";
import { FeeStatus, TransactionFeeService } from "../../src/chain-clients/utxo/TransactionFeeService";
import { BTC_DOGE_DEC_PLACES } from "../../src/utils/constants";
import { toBNExp } from "../../src/utils/bnutils";
import { TransactionUTXOService } from "../../src/chain-clients/utxo/TransactionUTXOService";
// eslint-disable-next-line @typescript-eslint/no-var-requires
const sinon = require("sinon");
use(chaiAsPromised);

const walletSecret = "wallet_secret";
const BTCMccConnectionTestInitial = {
    url: process.env.BTC_URL ?? "",
    apiTokenKey: process.env.FLARE_API_PORTAL_KEY ?? "",
    inTestnet: true,
    walletSecret: walletSecret,
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
        wClient = await BTC.initialize(BTCMccConnectionTest);

        await wClient.feeService?.setupHistory();
        void wClient.feeService?.startMonitoringFees();

        resetMonitoringOnForceExit(wClient);
    });

    beforeEach(async () => {
        sinon.restore();
        sinon.stub(ServiceRepository.get(wClient.chainType, TransactionFeeService), "getFeePerKB").resolves(new BN(1000));
    });

    it("It should fail if there's not enough UTXOs 1", async () => {
        sinon.stub(dbutils, "fetchUnspentUTXOs").resolves([
            createUTXOEntity(0, fundedAddress, "ef99f95e95b18adfc44aae79722946e583677eb631a89a1b62fe0e275801a10c", 0, SpentHeightEnum.UNSPENT, toBN(10020), "00143cbd2641a036e99579b5386b13a8c303f3b1cf0e"),
            createUTXOEntity(0, fundedAddress, "2a6a5d5607492467e357140426f48e75e5ab3fa5fb625b6f201cce284f0dc55e", 0, SpentHeightEnum.UNSPENT, toBN(1000), "00143cbd2641a036e99579b5386b13a8c303f3b1cf0e"),
            createUTXOEntity(0, fundedAddress, "b895eab0cd280d1bb07897576e2edbdd7791d8b85bb64e28a9b86952faf8fdc2", 0, SpentHeightEnum.UNSPENT, toBN(1000), "00143cbd2641a036e99579b5386b13a8c303f3b1cf0e"),
            createUTXOEntity(0, fundedAddress, "0b24228b83a64803ccf00f9878d56a0306c4b76f17c4b5bdc1cd35358e04feb5", 0, SpentHeightEnum.UNSPENT, toBN(1000), "00143cbd2641a036e99579b5386b13a8c303f3b1cf0e"),
        ]);

        await expect(ServiceRepository.get(wClient.chainType, TransactionService).preparePaymentTransaction(0, fundedAddress, targetAddress, toBN(100), toBN(15000)))
            .to.eventually.be.rejectedWith(`Not enough UTXOs for creating transaction 0`);
    });

    it("It should fail if there's not enough UTXOs 2", async () => {
        sinon.stub(dbutils, "fetchUnspentUTXOs").resolves([
            createUTXOEntity(0, fundedAddress, "ef99f95e95b18adfc44aae79722946e583677eb631a89a1b62fe0e275801a10c", 0, SpentHeightEnum.UNSPENT, toBN(10020), "00143cbd2641a036e99579b5386b13a8c303f3b1cf0e"),
            createUTXOEntity(0, fundedAddress, "2a6a5d5607492467e357140426f48e75e5ab3fa5fb625b6f201cce284f0dc55e", 0, SpentHeightEnum.UNSPENT, toBN(1000), "00143cbd2641a036e99579b5386b13a8c303f3b1cf0e"),
            createUTXOEntity(0, fundedAddress, "b895eab0cd280d1bb07897576e2edbdd7791d8b85bb64e28a9b86952faf8fdc2", 0, SpentHeightEnum.UNSPENT, toBN(1000), "00143cbd2641a036e99579b5386b13a8c303f3b1cf0e"),
            createUTXOEntity(0, fundedAddress, "0b24228b83a64803ccf00f9878d56a0306c4b76f17c4b5bdc1cd35358e04feb5", 0, SpentHeightEnum.UNSPENT, toBN(1000), "00143cbd2641a036e99579b5386b13a8c303f3b1cf0e"),
        ]);

        await expect(ServiceRepository.get(wClient.chainType, TransactionService).preparePaymentTransaction(0, fundedAddress, targetAddress, toBN(4000000), undefined))
            .to.eventually.be.rejectedWith(`Not enough UTXOs for creating transaction 0`);
    });

    it("Should prioritize small UTXOs when fee status is LOW", async () => {
        sinon.stub(dbutils, "fetchUnspentUTXOs").resolves([
            createUTXOEntity(0, fundedAddress, "ef99f95e95b18adfc44aae79722946e583677eb631a89a1b62fe0e275801a10c", 0, SpentHeightEnum.UNSPENT, toBN(100200000), "00143cbd2641a036e99579b5386b13a8c303f3b1cf0e"),
            createUTXOEntity(0, fundedAddress, "2a6a5d5607492467e357140426f48e75e5ab3fa5fb625b6f201cce284f0dc55e", 0, SpentHeightEnum.UNSPENT, toBN(110000), "00143cbd2641a036e99579b5386b13a8c303f3b1cf0e"),
            createUTXOEntity(0, fundedAddress, "b895eab0cd280d1bb07897576e2edbdd7791d8b85bb64e28a9b86952faf8fdc2", 0, SpentHeightEnum.UNSPENT, toBN(110000), "00143cbd2641a036e99579b5386b13a8c303f3b1cf0e"),
            createUTXOEntity(0, fundedAddress, "0b24228b83a64803ccf00f9878d56a0306c4b76f17c4b5bdc1cd35358e04feb5", 0, SpentHeightEnum.UNSPENT, toBN(110200000), "00143cbd2641a036e99579b5386b13a8c303f3b1cf0e"),
            createUTXOEntity(0, fundedAddress, "b8aac7ed190bf30610cd904e533eadabfee824054eb14a1e3a56cf1965b495d5", 0, SpentHeightEnum.UNSPENT, toBN(140200000), "00143cbd2641a036e99579b5386b13a8c303f3b1cf0e"),
            createUTXOEntity(0, fundedAddress, "52cf7492f717363cef1befcb7b4972adb053b65f2ec1763ac95c1e6312868dc6", 0, SpentHeightEnum.UNSPENT, toBN(130200000), "00143cbd2641a036e99579b5386b13a8c303f3b1cf0e"),
            createUTXOEntity(0, fundedAddress, "de3e8d9439325c51876e039cda60c35dc491e3c7c9045ae43759c011108993c6", 0, SpentHeightEnum.UNSPENT, toBN(110000), "00143cbd2641a036e99579b5386b13a8c303f3b1cf0e"),
        ]);
        sinon.stub(ServiceRepository.get(wClient.chainType, TransactionFeeService), "getCurrentFeeStatus").resolves(FeeStatus.LOW);

        const [tr, utxos] = await ServiceRepository.get(wClient.chainType, TransactionService).preparePaymentTransaction(0, fundedAddress, targetAddress, toBN(250000), undefined);
        expect(utxos.filter(t => t.value.lten(110000)).length).to.be.eq(3);
    });

    it("Should prioritize large UTXOs when fee status is HIGH", async () => {
        sinon.stub(dbutils, "fetchUnspentUTXOs").resolves([
            createUTXOEntity(0, fundedAddress, "ef99f95e95b18adfc44aae79722946e583677eb631a89a1b62fe0e275801a10c", 0, SpentHeightEnum.UNSPENT, toBN(100200000), "00143cbd2641a036e99579b5386b13a8c303f3b1cf0e"),
            createUTXOEntity(0, fundedAddress, "2a6a5d5607492467e357140426f48e75e5ab3fa5fb625b6f201cce284f0dc55e", 0, SpentHeightEnum.UNSPENT, toBN(900000), "00143cbd2641a036e99579b5386b13a8c303f3b1cf0e"),
            createUTXOEntity(0, fundedAddress, "b895eab0cd280d1bb07897576e2edbdd7791d8b85bb64e28a9b86952faf8fdc2", 0, SpentHeightEnum.UNSPENT, toBN(900000), "00143cbd2641a036e99579b5386b13a8c303f3b1cf0e"),
            createUTXOEntity(0, fundedAddress, "0b24228b83a64803ccf00f9878d56a0306c4b76f17c4b5bdc1cd35358e04feb5", 0, SpentHeightEnum.UNSPENT, toBN(110200000), "00143cbd2641a036e99579b5386b13a8c303f3b1cf0e"),
        ]);
        sinon.stub(ServiceRepository.get(wClient.chainType, TransactionFeeService), "getCurrentFeeStatus").resolves(FeeStatus.HIGH);

        const [tr, utxos] = await ServiceRepository.get(wClient.chainType, TransactionService).preparePaymentTransaction(0, fundedAddress, targetAddress, toBN(1000000), undefined);
        expect(utxos.length).to.be.lte(2);
    });

    it("Should add small UTXOs for consolidation when fee status is LOW", async () => {
        sinon.stub(dbutils, "fetchUnspentUTXOs").resolves([
            createUTXOEntity(0, fundedAddress, "ef99f95e95b18adfc44aae79722946e583677eb631a89a1b62fe0e275801a10c", 0, SpentHeightEnum.UNSPENT, toBN(1002000), "00143cbd2641a036e99579b5386b13a8c303f3b1cf0e"),
            createUTXOEntity(0, fundedAddress, "2a6a5d5607492467e357140426f48e75e5ab3fa5fb625b6f201cce284f0dc55e", 0, SpentHeightEnum.UNSPENT, toBN(100), "00143cbd2641a036e99579b5386b13a8c303f3b1cf0e"),
            createUTXOEntity(0, fundedAddress, "b895eab0cd280d1bb07897576e2edbdd7791d8b85bb64e28a9b86952faf8fdc2", 0, SpentHeightEnum.UNSPENT, toBN(300), "00143cbd2641a036e99579b5386b13a8c303f3b1cf0e"),
            createUTXOEntity(0, fundedAddress, "0b24228b83a64803ccf00f9878d56a0306c4b76f17c4b5bdc1cd35358e04feb5", 0, SpentHeightEnum.UNSPENT, toBN(1004000), "00143cbd2641a036e99579b5386b13a8c303f3b1cf0e"),
            createUTXOEntity(0, fundedAddress, "b8aac7ed190bf30610cd904e533eadabfee824054eb14a1e3a56cf1965b495d5", 0, SpentHeightEnum.UNSPENT, toBN(1100200000), "00143cbd2641a036e99579b5386b13a8c303f3b1cf0e"),
            createUTXOEntity(0, fundedAddress, "52cf7492f717363cef1befcb7b4972adb053b65f2ec1763ac95c1e6312868dc6", 0, SpentHeightEnum.UNSPENT, toBN(1100200000), "00143cbd2641a036e99579b5386b13a8c303f3b1cf0e"),
        ]);
        sinon.stub(ServiceRepository.get(wClient.chainType, TransactionFeeService), "getCurrentFeeStatus").resolves(FeeStatus.LOW);

        const [tr, utxos] = await ServiceRepository.get(wClient.chainType, TransactionService).preparePaymentTransaction(0, fundedAddress, targetAddress, toBN(2002000), undefined);
        expect(utxos.filter(t => t.value.lten(300)).length).to.be.eq(2);
    });

    it("Should not add small UTXOs for consolidation when fee status is HIGH", async () => {
        sinon.stub(dbutils, "fetchUnspentUTXOs").resolves([
            createUTXOEntity(0, fundedAddress, "ef99f95e95b18adfc44aae79722946e583677eb631a89a1b62fe0e275801a10c", 0, SpentHeightEnum.UNSPENT, toBN(1002000), "00143cbd2641a036e99579b5386b13a8c303f3b1cf0e"),
            createUTXOEntity(0, fundedAddress, "2a6a5d5607492467e357140426f48e75e5ab3fa5fb625b6f201cce284f0dc55e", 0, SpentHeightEnum.UNSPENT, toBN(100), "00143cbd2641a036e99579b5386b13a8c303f3b1cf0e"),
            createUTXOEntity(0, fundedAddress, "b895eab0cd280d1bb07897576e2edbdd7791d8b85bb64e28a9b86952faf8fdc2", 0, SpentHeightEnum.UNSPENT, toBN(300), "00143cbd2641a036e99579b5386b13a8c303f3b1cf0e"),
            createUTXOEntity(0, fundedAddress, "0b24228b83a64803ccf00f9878d56a0306c4b76f17c4b5bdc1cd35358e04feb5", 0, SpentHeightEnum.UNSPENT, toBN(1004000), "00143cbd2641a036e99579b5386b13a8c303f3b1cf0e"),
            createUTXOEntity(0, fundedAddress, "b8aac7ed190bf30610cd904e533eadabfee824054eb14a1e3a56cf1965b495d5", 0, SpentHeightEnum.UNSPENT, toBN(1100200000), "00143cbd2641a036e99579b5386b13a8c303f3b1cf0e"),
            createUTXOEntity(0, fundedAddress, "52cf7492f717363cef1befcb7b4972adb053b65f2ec1763ac95c1e6312868dc6", 0, SpentHeightEnum.UNSPENT, toBN(1100200000), "00143cbd2641a036e99579b5386b13a8c303f3b1cf0e"),
        ]);
        sinon.stub(ServiceRepository.get(wClient.chainType, TransactionFeeService), "getCurrentFeeStatus").resolves(FeeStatus.HIGH);

        const [tr, utxos] = await ServiceRepository.get(wClient.chainType, TransactionService).preparePaymentTransaction(0, fundedAddress, targetAddress, toBN(2002000), undefined);
        expect(utxos.filter(t => t.value.lten(300)).length).to.be.eq(0);
    });

    it("When doing RBF original UTXOs should be returned also", async () => {
        sinon.stub(dbutils, "fetchUnspentUTXOs").resolves([
            createUTXOEntity(0, fundedAddress, "0b24228b83a64803ccf00f9878d56a0306c4b76f17c4b5bdc1cd35358e04feb5", 0, SpentHeightEnum.UNSPENT, toBN(1004000), "00143cbd2641a036e99579b5386b13a8c303f3b1cf0e"),
            createUTXOEntity(0, fundedAddress, "b8aac7ed190bf30610cd904e533eadabfee824054eb14a1e3a56cf1965b495d5", 0, SpentHeightEnum.UNSPENT, toBN(1100200000), "00143cbd2641a036e99579b5386b13a8c303f3b1cf0e"),
            createUTXOEntity(0, fundedAddress, "52cf7492f717363cef1befcb7b4972adb053b65f2ec1763ac95c1e6312868dc6", 0, SpentHeightEnum.UNSPENT, toBN(1100200000), "00143cbd2641a036e99579b5386b13a8c303f3b1cf0e"),
        ]);
        sinon.stub(ServiceRepository.get(wClient.chainType, TransactionFeeService), "getCurrentFeeStatus").resolves(FeeStatus.HIGH);

        const originalUTXOs = [
            createUTXOEntity(0, fundedAddress, "ef99f95e95b18adfc44aae79722946e583677eb631a89a1b62fe0e275801a10c", 0, SpentHeightEnum.UNSPENT, toBN(10020), "00143cbd2641a036e99579b5386b13a8c303f3b1cf0e"),
            createUTXOEntity(0, fundedAddress, "2a6a5d5607492467e357140426f48e75e5ab3fa5fb625b6f201cce284f0dc55e", 0, SpentHeightEnum.UNSPENT, toBN(1000), "00143cbd2641a036e99579b5386b13a8c303f3b1cf0e"),
            createUTXOEntity(0, fundedAddress, "b895eab0cd280d1bb07897576e2edbdd7791d8b85bb64e28a9b86952faf8fdc2", 0, SpentHeightEnum.UNSPENT, toBN(1000), "00143cbd2641a036e99579b5386b13a8c303f3b1cf0e"),
        ];

        const originalTxEnt = createTransactionEntity(0, fundedAddress, targetAddress, toBNExp(1, BTC_DOGE_DEC_PLACES), originalUTXOs);

        const [tr, newUTXOs] = await ServiceRepository.get(wClient.chainType, TransactionService).preparePaymentTransaction(0, fundedAddress, targetAddress, toBN(2002000), undefined, undefined, originalTxEnt);

        const utxoSet = new Set(newUTXOs);
        expect(originalUTXOs.filter(t => utxoSet.has(t)).length).to.be.eq(originalUTXOs.length);
        expect(utxoSet.size).to.be.gt(originalUTXOs.length);
    });

    it("If a fixed fee is set it should be obliged", async () => {
        sinon.stub(dbutils, "fetchUnspentUTXOs").resolves([
            createUTXOEntity(0, fundedAddress, "ef99f95e95b18adfc44aae79722946e583677eb631a89a1b62fe0e275801a10c", 0, SpentHeightEnum.UNSPENT, toBN(100200000), "00143cbd2641a036e99579b5386b13a8c303f3b1cf0e"),
            createUTXOEntity(0, fundedAddress, "2a6a5d5607492467e357140426f48e75e5ab3fa5fb625b6f201cce284f0dc55e", 0, SpentHeightEnum.UNSPENT, toBN(900000), "00143cbd2641a036e99579b5386b13a8c303f3b1cf0e"),
            createUTXOEntity(0, fundedAddress, "b895eab0cd280d1bb07897576e2edbdd7791d8b85bb64e28a9b86952faf8fdc2", 0, SpentHeightEnum.UNSPENT, toBN(900000), "00143cbd2641a036e99579b5386b13a8c303f3b1cf0e"),
            createUTXOEntity(0, fundedAddress, "0b24228b83a64803ccf00f9878d56a0306c4b76f17c4b5bdc1cd35358e04feb5", 0, SpentHeightEnum.UNSPENT, toBN(110200000), "00143cbd2641a036e99579b5386b13a8c303f3b1cf0e"),
        ]);
        sinon.stub(ServiceRepository.get(wClient.chainType, TransactionFeeService), "getCurrentFeeStatus").resolves(FeeStatus.HIGH);

        const feeInSatoshi = toBN(500000);
        const [tr, utxos] = await ServiceRepository.get(wClient.chainType, TransactionService).preparePaymentTransaction(0, fundedAddress, targetAddress, toBN(1000000), feeInSatoshi);
        expect(tr.getFee()).to.be.eq(feeInSatoshi.toNumber());
    });

    it("If the remaining part is less than dust it should be used as additional fee when fee status is", async () => {
        sinon.stub(ServiceRepository.get(wClient.chainType, TransactionUTXOService), "fetchUTXOs").resolves([
            createUTXOEntity(0, fundedAddress, "0b24228b83a64803ccf00f9878d56a0306c4b76f17c4b5bdc1cd35358e04feb5", 0, SpentHeightEnum.UNSPENT, toBN(1000), "00143cbd2641a036e99579b5386b13a8c303f3b1cf0e"),
            createUTXOEntity(0, fundedAddress, "b8aac7ed190bf30610cd904e533eadabfee824054eb14a1e3a56cf1965b495d5", 0, SpentHeightEnum.UNSPENT, toBN(2000), "00143cbd2641a036e99579b5386b13a8c303f3b1cf0e"),
            createUTXOEntity(0, fundedAddress, "52cf7492f717363cef1befcb7b4972adb053b65f2ec1763ac95c1e6312868dc6", 0, SpentHeightEnum.UNSPENT, toBN(5000), "00143cbd2641a036e99579b5386b13a8c303f3b1cf0e"),
        ]);

        const [tr, utxos] = await ServiceRepository.get(wClient.chainType, TransactionService).preparePaymentTransaction(0, fundedAddress, targetAddress, toBN(7600));

        expect(tr.outputs.length).to.be.eq(1);
    });

    it("Delete account transaction", async () => {
        const utxos = [
            createUTXOEntity(0, fundedAddress, "0b24228b83a64803ccf00f9878d56a0306c4b76f17c4b5bdc1cd35358e04feb5", 0, SpentHeightEnum.UNSPENT, toBN(1000), "00143cbd2641a036e99579b5386b13a8c303f3b1cf0e"),
            createUTXOEntity(0, fundedAddress, "b8aac7ed190bf30610cd904e533eadabfee824054eb14a1e3a56cf1965b495d5", 0, SpentHeightEnum.UNSPENT, toBN(2000), "00143cbd2641a036e99579b5386b13a8c303f3b1cf0e"),
            createUTXOEntity(0, fundedAddress, "52cf7492f717363cef1befcb7b4972adb053b65f2ec1763ac95c1e6312868dc6", 0, SpentHeightEnum.UNSPENT, toBN(5000), "00143cbd2641a036e99579b5386b13a8c303f3b1cf0e"),
        ];
        sinon.stub(dbutils, "fetchUnspentUTXOs").resolves(utxos);
        sinon.stub(ServiceRepository.get(wClient.chainType, TransactionUTXOService), "fetchUTXOs").resolves(utxos);
        sinon.stub(utxoutils, "getAccountBalance").resolves(new BN(8000));

        const [tr, ] = await ServiceRepository.get(wClient.chainType, TransactionService).preparePaymentTransaction(0, fundedAddress, targetAddress, null);
        expect(tr.outputs.length).to.be.eq(1);
        expect(tr.outputs[0].satoshis).to.be.eq(7755); // 3 inputs + 1 output = 245 vBytes
    });

});


function createUTXOEntity(id: number, source: string, mintTransactionHash: string, position: 0, spentHeight: SpentHeightEnum, value: BN, script: string) {
    const utxoEnt = new UTXOEntity();
    utxoEnt.id = id;
    utxoEnt.source = source;
    utxoEnt.mintTransactionHash = mintTransactionHash;
    utxoEnt.position = position;
    utxoEnt.spentHeight = spentHeight;
    utxoEnt.script = script;
    utxoEnt.value = value;
    return utxoEnt;
}

function createTransactionEntity(id: number, source: string, destination: string, fee: BN, utxos: UTXOEntity[]) {
    const txEnt = new TransactionEntity();
    txEnt.id = id;
    txEnt.source = source;
    txEnt.destination = destination;
    txEnt.fee = fee;
    txEnt.utxos.set(utxos);
    return txEnt;
}

const utxoList = [
    createUTXOEntity(0, fundedAddress, "ef99f95e95b18adfc44aae79722946e583677eb631a89a1b62fe0e275801a10c", 0, SpentHeightEnum.UNSPENT, toBN(10020), "00143cbd2641a036e99579b5386b13a8c303f3b1cf0e"),
    createUTXOEntity(0, fundedAddress, "2a6a5d5607492467e357140426f48e75e5ab3fa5fb625b6f201cce284f0dc55e", 0, SpentHeightEnum.UNSPENT, toBN(1000), "00143cbd2641a036e99579b5386b13a8c303f3b1cf0e"),
    createUTXOEntity(0, fundedAddress, "b895eab0cd280d1bb07897576e2edbdd7791d8b85bb64e28a9b86952faf8fdc2", 0, SpentHeightEnum.UNSPENT, toBN(1000), "00143cbd2641a036e99579b5386b13a8c303f3b1cf0e"),
    createUTXOEntity(0, fundedAddress, "0b24228b83a64803ccf00f9878d56a0306c4b76f17c4b5bdc1cd35358e04feb5", 0, SpentHeightEnum.UNSPENT, toBN(1000), "00143cbd2641a036e99579b5386b13a8c303f3b1cf0e"),
    createUTXOEntity(0, fundedAddress, "b8aac7ed190bf30610cd904e533eadabfee824054eb14a1e3a56cf1965b495d5", 0, SpentHeightEnum.UNSPENT, toBN(1000), "00143cbd2641a036e99579b5386b13a8c303f3b1cf0e"),
    createUTXOEntity(0, fundedAddress, "52cf7492f717363cef1befcb7b4972adb053b65f2ec1763ac95c1e6312868dc6", 0, SpentHeightEnum.UNSPENT, toBN(1000), "00143cbd2641a036e99579b5386b13a8c303f3b1cf0e"),
    createUTXOEntity(0, fundedAddress, "de3e8d9439325c51876e039cda60c35dc491e3c7c9045ae43759c011108993c6", 0, SpentHeightEnum.UNSPENT, toBN(1000), "00143cbd2641a036e99579b5386b13a8c303f3b1cf0e"),
    createUTXOEntity(0, fundedAddress, "1a31d01de95dc4346084c387731701d7d09dec86bcceefcf6a048e18ab2a4c7b", 0, SpentHeightEnum.UNSPENT, toBN(1000), "00143cbd2641a036e99579b5386b13a8c303f3b1cf0e"),
    createUTXOEntity(0, fundedAddress, "eb4806e9b879ef4431edf322f1b5cb3b454e79003bbeaa1d2b5000d20719fdbc", 0, SpentHeightEnum.UNSPENT, toBN(1000), "00143cbd2641a036e99579b5386b13a8c303f3b1cf0e"),
    createUTXOEntity(0, fundedAddress, "f165d22a1a63dd45921c597cf77a51224db146c60b873f81866ed8d352eca54c", 0, SpentHeightEnum.UNSPENT, toBN(1000), "00143cbd2641a036e99579b5386b13a8c303f3b1cf0e"),
    createUTXOEntity(0, fundedAddress, "281219ee58c3cc5dfb14ba1e62ac306dab6ad75a1c63909d257a5bcc7427af21", 0, SpentHeightEnum.UNSPENT, toBN(1000), "00143cbd2641a036e99579b5386b13a8c303f3b1cf0e"),
    createUTXOEntity(0, fundedAddress, "e71687c5b4f26a28800334f4d33ef17b6a2e3cb8549af120649e4898659e1e62", 0, SpentHeightEnum.UNSPENT, toBN(1000), "00143cbd2641a036e99579b5386b13a8c303f3b1cf0e"),
    createUTXOEntity(0, fundedAddress, "6c92762544368c03c3c609cd1edcb9dd4b50759a9e864a67555806ba42e1851c", 0, SpentHeightEnum.UNSPENT, toBN(1000), "00143cbd2641a036e99579b5386b13a8c303f3b1cf0e"),
];
