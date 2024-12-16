import {
    BitcoinWalletConfig,
    BTC,
    ICreateWalletResponse,
    ITransactionMonitor,
    logger,
    TransactionStatus,
} from "../../src";
import config, { initializeTestMikroORMWithConfig } from "../test-orm/mikro-orm.config";
import { UnprotectedDBWalletKeys } from "../test-orm/UnprotectedDBWalletKey";
import { addConsoleTransportForTests, waitForTxToFinishWithStatus } from "../test-util/common_utils";
import { UTXOWalletImplementation } from "../../src/chain-clients/implementations/UTXOWalletImplementation";
import sinon from "sinon";
import { updateTransactionEntity } from "../../src/db/dbutils";
import {
    createUTXO
} from "../test-util/entity_utils";
import { toBN } from "web3-utils";
import BN from "bn.js";
import * as bitcore from "bitcore-lib";
import { expect } from "chai";
import { UTXORawTransaction } from "../../src/interfaces/IBlockchainAPI";
import { BtcWalletImplementation } from "../../src/chain-clients/implementations/BtcWalletImplementation";
import { TransactionUTXOService } from "../../src/chain-clients/utxo/TransactionUTXOService";
import { TransactionFeeService } from "../../src/chain-clients/utxo/TransactionFeeService";
import { UTXOBlockchainAPI } from "../../src/blockchain-apis/UTXOBlockchainAPI";
import { BlockchainFeeService } from "../../src/fee-service/fee-service";
import * as utxoUtils from "../../src/chain-clients/utxo/UTXOUtils";
import { BTC_DOGE_DEC_PLACES, ChainType } from "../../src/utils/constants";
import { toBNExp } from "../../src/utils/bnutils";

const fundedMnemonic = "theme damage online elite clown fork gloom alpha scorpion welcome ladder camp rotate cheap gift stone fog oval soda deputy game jealous relax muscle";
const fundedAddress = "tb1qyghw9dla9vl0kutujnajvl6eyj0q2nmnlnx3j0";

const feeWalletMnemonic = "express exhibit hidden disease order baby photo pair fantasy age chaos velvet very nerve display soldier kite profit actress emerge soup hover clay canyon";
const feeWalletAddress = "tb1qtsvem7ytc9rv37m8qjuuw08keh0zkapd6fgg0c";

const targetAddress = "tb1q8j7jvsdqxm5e27d48p4382xrq0emrncwfr35k4";
const amountToSendSatoshi = toBN(100020);

const BTCMccConnectionTestInitial = {
    urls: [process.env.BTC_URL ?? ""],
    inTestnet: true,
};
let BTCMccConnectionTest: BitcoinWalletConfig;
let wClient: UTXOWalletImplementation;
let monitor: ITransactionMonitor;

let fundedWallet: ICreateWalletResponse;
let feeWallet: ICreateWalletResponse;

describe("UTXOWalletImplementation unit tests", () => {
    let removeConsoleLogging: () => void;
    let getBlockHeightStub: sinon.SinonStub;
    const startBlockHeight = 100;

    before(async () => {
        removeConsoleLogging = addConsoleTransportForTests(logger);

        const conf = {...config};
        conf.dbName = "unit-test-db";
        const em = (await initializeTestMikroORMWithConfig(conf)).em;
        const unprotectedDBWalletKeys = new UnprotectedDBWalletKeys(em);
        BTCMccConnectionTest = {
            ...BTCMccConnectionTestInitial,
            em: em,
            walletKeys: unprotectedDBWalletKeys,
            enoughConfirmations: 2
        };
        wClient = BTC.initialize(BTCMccConnectionTest);

        fundedWallet = wClient.createWalletFromMnemonic(fundedMnemonic);
        feeWallet = wClient.createWalletFromMnemonic(feeWalletMnemonic);

        await wClient.walletKeys.addKey(fundedWallet.address, fundedWallet.privateKey);
        await wClient.walletKeys.addKey(feeWallet.address, feeWallet.privateKey);

        monitor = await wClient.createMonitor();
        await monitor.startMonitoring();

        await wClient.walletKeys.addKey(fundedWallet.address, fundedWallet.privateKey);
        await wClient.walletKeys.addKey(feeWallet.address, feeWallet.privateKey);
    });

    beforeEach(() => {
        getBlockHeightStub = sinon.stub(UTXOBlockchainAPI.prototype, "getCurrentBlockHeight").callsFake(async () => {
            const elapsedSeconds = (Date.now() - startTime) / 1000;
            return startBlockHeight + Math.floor(elapsedSeconds / 20);
        });

        const startTime = Date.now();

        sinon.stub(TransactionUTXOService.prototype, "getNumberOfMempoolAncestors").resolves(0);
        sinon.stub(TransactionFeeService.prototype, "getFeePerKB").resolves(new BN(1000));
        sinon.stub(BtcWalletImplementation.prototype, "signAndSubmitProcess").callsFake(async (txId: number, transaction: bitcore.Transaction, privateKey: string, privateKeyForFee?: string) => {
                await updateTransactionEntity(wClient.rootEm, txId, (txEntToUpdate) => {
                    txEntToUpdate.status = TransactionStatus.TX_SUCCESS;
                });
                console.info("SignAndSubmit stub");
            }
        );
        sinon.stub(TransactionUTXOService.prototype, "filteredAndSortedMempoolUTXOs").resolves([
            createUTXO("ef99f95e95b18adfc44aae79722946e583677eb631a89a1b62fe0e275801a10c", 0, amountToSendSatoshi, "00143cbd2641a036e99579b5386b13a8c303f3b1cf0e"),
            createUTXO("2a6a5d5607492467e357140426f48e75e5ab3fa5fb625b6f201cce284f0dc55e", 0, amountToSendSatoshi, "00143cbd2641a036e99579b5386b13a8c303f3b1cf0e"),
            createUTXO("b895eab0cd280d1bb07897576e2edbdd7791d8b85bb64e28a9b86952faf8fdc2", 0, amountToSendSatoshi, "00143cbd2641a036e99579b5386b13a8c303f3b1cf0e"),
            createUTXO("0b24228b83a64803ccf00f9878d56a0306c4b76f17c4b5bdc1cd35358e04feb5", 0, amountToSendSatoshi, "00143cbd2641a036e99579b5386b13a8c303f3b1cf0e"),
            createUTXO("ecc69dd75993648fb43eecdd7b9dda0c8e024cfb6184af0e3da7529b87d2c93c", 0, amountToSendSatoshi, "00145c199df88bc146c8fb6704b9c73cf6cdde2b742d"),
            createUTXO("8db38a83f395bc071774e30cb2c8b16424116e7a0f250d1a05f468a8e86e5a20", 0, amountToSendSatoshi, "00145c199df88bc146c8fb6704b9c73cf6cdde2b742d"),
            createUTXO("2032783d52a425fe30d38e97c01335435d7adb89fc81f10cf9bb03b36197dd12", 0, amountToSendSatoshi, "00145c199df88bc146c8fb6704b9c73cf6cdde2b742d"),
            createUTXO("86456ccb0850e18ab3db82e104b45df0993889ddc307df3b1f6434d9431e9911", 0, amountToSendSatoshi, "00145c199df88bc146c8fb6704b9c73cf6cdde2b742d"),
        ]);
    });

    afterEach(() => {
        sinon.restore();
    });

    after(async () => {
        await monitor.stopMonitoring();
        removeConsoleLogging();
        sinon.restore();
    });

    it("Should successfully create transaction with fee < maxFee", async () => {
        // Transaction size is 276.5 (3 inputs + 2 outputs) > 100 (maxFee)
        const id = await wClient.createPaymentTransaction(fundedAddress, targetAddress, amountToSendSatoshi.muln(2), undefined, undefined, toBN(500), startBlockHeight + 5);
        await waitForTxToFinishWithStatus(2, 300, wClient.rootEm, TransactionStatus.TX_SUCCESS, id);
    });

    it("Transaction with too high fee should eventually fail", async () => {
        // Transaction size is 276.5 (3 inputs + 2 outputs) > 100 (maxFee)
        const id = await wClient.createPaymentTransaction(fundedAddress, targetAddress, amountToSendSatoshi.muln(2), undefined, undefined, toBN(100), startBlockHeight + 3);
        await waitForTxToFinishWithStatus(2, 300, wClient.rootEm, TransactionStatus.TX_FAILED, id);
    });

    it("Transaction with fee too high for fee wallet and main wallet should eventually fail", async () => {
        // Transaction size is 276.5 (3 inputs + 2 outputs) > 100 (maxFee)
        const id = await wClient.createPaymentTransaction(fundedAddress, targetAddress, amountToSendSatoshi.muln(2), undefined, undefined, toBN(100), startBlockHeight + 3, undefined, undefined, feeWalletAddress, toBN(100));
        await waitForTxToFinishWithStatus(2, 300, wClient.rootEm, TransactionStatus.TX_FAILED, id);
    });

    it("Transaction with fee too high for fee wallet should be tried with main wallet", async () => {
        // Transaction size is 276.5 (3 inputs + 2 outputs) > 100 (maxFee)
        const id = await wClient.createPaymentTransaction(fundedAddress, targetAddress, amountToSendSatoshi.muln(2), undefined, undefined, toBN(500), startBlockHeight + 5, undefined, undefined, feeWalletAddress, toBN(100));
        const [txEnt,] = await waitForTxToFinishWithStatus(2, 300, wClient.rootEm, TransactionStatus.TX_SUCCESS, id);

        const tr = JSON.parse(txEnt.raw!) as UTXORawTransaction;
        expect(tr.inputs.filter(t => t.output.script !== "00143cbd2641a036e99579b5386b13a8c303f3b1cf0e").length).to.be.eq(0); // funded wallet script (fee wallet has a different one)
    });

    it("If getCurrentFeeRate is down the fee should be the default one", async () => {
        sinon.restore();

        sinon.stub(BlockchainFeeService.prototype, "getLatestFeeStats").rejects(new Error("No fee stats"));
        sinon.stub(UTXOBlockchainAPI.prototype, "getCurrentFeeRate").rejects(new Error("No fee"));
        sinon.stub(TransactionUTXOService.prototype, "filteredAndSortedMempoolUTXOs").resolves([
            createUTXO("ef99f95e95b18adfc44aae79722946e583677eb631a89a1b62fe0e275801a10c", 0, amountToSendSatoshi, "00143cbd2641a036e99579b5386b13a8c303f3b1cf0e"),
            createUTXO("2a6a5d5607492467e357140426f48e75e5ab3fa5fb625b6f201cce284f0dc55e", 0, amountToSendSatoshi, "00143cbd2641a036e99579b5386b13a8c303f3b1cf0e")]);

        const [tr,] = await wClient.transactionService.preparePaymentTransactionWithSingleWallet(0, fundedAddress, targetAddress, amountToSendSatoshi, undefined);
        const fee1 = tr.getFee();
        const fee2 = tr.feePerKb(utxoUtils.getDefaultFeePerKB(ChainType.testBTC).toNumber()).getFee();
        expect(fee1).to.be.eq(fee2);
    });

    it("If fee service is down the getCurrentFeeRate should be used", async () => {
        sinon.restore();

        const fee = 0.0005;
        const feeRateInSatoshi = toBNExp(fee, BTC_DOGE_DEC_PLACES).muln(wClient.feeIncrease);

        sinon.stub(BlockchainFeeService.prototype, "getLatestFeeStats").rejects(new Error("No fee stats"));
        sinon.stub(UTXOBlockchainAPI.prototype, "getCurrentFeeRate").resolves(toBNExp(fee, BTC_DOGE_DEC_PLACES).toNumber());
        sinon.stub(TransactionUTXOService.prototype, "filteredAndSortedMempoolUTXOs").resolves([
            createUTXO("ef99f95e95b18adfc44aae79722946e583677eb631a89a1b62fe0e275801a10c", 0, amountToSendSatoshi, "00143cbd2641a036e99579b5386b13a8c303f3b1cf0e"),
            createUTXO("2a6a5d5607492467e357140426f48e75e5ab3fa5fb625b6f201cce284f0dc55e", 0, amountToSendSatoshi, "00143cbd2641a036e99579b5386b13a8c303f3b1cf0e")]);

        const [tr,] = await wClient.transactionService.preparePaymentTransactionWithSingleWallet(0, fundedAddress, targetAddress, amountToSendSatoshi, undefined);
        const fee1 = tr.getFee();
        const fee2 = tr.feePerKb(feeRateInSatoshi.toNumber()).getFee();
        expect(fee1).to.be.eq(fee2);
    });
});
