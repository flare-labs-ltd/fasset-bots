import {
    BitcoinWalletConfig,
    BTC,
    ICreateWalletResponse,
    ITransactionMonitor,
    logger,
    TransactionStatus,
} from "../../src";
import config, {initializeTestMikroORMWithConfig} from "../test-orm/mikro-orm.config";
import {UnprotectedDBWalletKeys} from "../test-orm/UnprotectedDBWalletKey";
import {addConsoleTransportForTests, loop, waitForTxToFinishWithStatus} from "../test-util/common_utils";
import {UTXOWalletImplementation} from "../../src/chain-clients/implementations/UTXOWalletImplementation";
import sinon from "sinon";
import {fetchTransactionEntityById, updateTransactionEntity} from "../../src/db/dbutils";
import {
    createAndPersistTransactionEntity,
    createUTXO,
    setMonitoringStatus
} from "../test-util/entity_utils";
import {toBN} from "web3-utils";
import BN from "bn.js";
import * as bitcore from "bitcore-lib";
import {expect} from "chai";
import {UTXORawTransaction} from "../../src/interfaces/IBlockchainAPI";

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

        sinon.stub(wClient.transactionUTXOService, "getNumberOfMempoolAncestors").resolves(0);
        sinon.stub(wClient.transactionFeeService, "getFeePerKB").resolves(new BN(1000));
        sinon.stub(wClient, "signAndSubmitProcess").callsFake(async (txId: number, transaction: bitcore.Transaction, privateKey: string, privateKeyForFee?: string) =>
            await updateTransactionEntity(wClient.rootEm, txId, (txEntToUpdate) => {
                txEntToUpdate.status = TransactionStatus.TX_SUCCESS;
            })
        );
        sinon.stub(wClient.transactionUTXOService, "filteredAndSortedMempoolUTXOs").resolves([
            createUTXO( "ef99f95e95b18adfc44aae79722946e583677eb631a89a1b62fe0e275801a10c", 0,amountToSendSatoshi, "00143cbd2641a036e99579b5386b13a8c303f3b1cf0e"),
            createUTXO( "2a6a5d5607492467e357140426f48e75e5ab3fa5fb625b6f201cce284f0dc55e", 0,amountToSendSatoshi, "00143cbd2641a036e99579b5386b13a8c303f3b1cf0e"),
            createUTXO( "b895eab0cd280d1bb07897576e2edbdd7791d8b85bb64e28a9b86952faf8fdc2", 0,amountToSendSatoshi, "00143cbd2641a036e99579b5386b13a8c303f3b1cf0e"),
            createUTXO( "0b24228b83a64803ccf00f9878d56a0306c4b76f17c4b5bdc1cd35358e04feb5", 0,amountToSendSatoshi, "00143cbd2641a036e99579b5386b13a8c303f3b1cf0e"),
            createUTXO( "ecc69dd75993648fb43eecdd7b9dda0c8e024cfb6184af0e3da7529b87d2c93c", 0,amountToSendSatoshi, "00145c199df88bc146c8fb6704b9c73cf6cdde2b742d"),
            createUTXO( "8db38a83f395bc071774e30cb2c8b16424116e7a0f250d1a05f468a8e86e5a20", 0,amountToSendSatoshi, "00145c199df88bc146c8fb6704b9c73cf6cdde2b742d"),
            createUTXO( "2032783d52a425fe30d38e97c01335435d7adb89fc81f10cf9bb03b36197dd12", 0,amountToSendSatoshi, "00145c199df88bc146c8fb6704b9c73cf6cdde2b742d"),
            createUTXO( "86456ccb0850e18ab3db82e104b45df0993889ddc307df3b1f6434d9431e9911", 0, amountToSendSatoshi, "00145c199df88bc146c8fb6704b9c73cf6cdde2b742d"),
        ]);

        monitor = await wClient.createMonitor();
        await monitor.startMonitoring();
    });

    after(async () => {
        await monitor.stopMonitoring();
        try {
            await loop(100, 2000, null, async () => {
                if (!monitor.isMonitoring()) return true;
            });
        } catch (e) {
            await setMonitoringStatus(wClient.rootEm, wClient.chainType, 0);
        }
        removeConsoleLogging();
        sinon.restore();
    });
    // TODO-test (all of them)
    it("Should successfully create transaction with fee < maxFee", async () => {
        // Transaction size is 276.5 (3 inputs + 2 outputs) > 100 (maxFee)
        const startBlockHeight = await wClient.blockchainAPI.getCurrentBlockHeight();
        const id = await wClient.createPaymentTransaction(fundedAddress, targetAddress, amountToSendSatoshi.muln(2), undefined, undefined, toBN(500), startBlockHeight + 2);
        await waitForTxToFinishWithStatus(2, 30, wClient.rootEm, TransactionStatus.TX_SUCCESS, id);
    });

    it("Transaction with too high fee should eventually fail", async () => {
        // Transaction size is 276.5 (3 inputs + 2 outputs) > 100 (maxFee)
        const startBlockHeight = await wClient.blockchainAPI.getCurrentBlockHeight();
        const id = await wClient.createPaymentTransaction(fundedAddress, targetAddress, amountToSendSatoshi.muln(2), undefined, undefined, toBN(100), startBlockHeight + 2);
        await waitForTxToFinishWithStatus(2, 30, wClient.rootEm, TransactionStatus.TX_FAILED, id);
    });

    it("Transaction with fee too high for fee wallet and main wallet should eventually fail", async () => {
        // Transaction size is 276.5 (3 inputs + 2 outputs) > 100 (maxFee)
        const startBlockHeight = await wClient.blockchainAPI.getCurrentBlockHeight();
        const id = await wClient.createPaymentTransaction(fundedAddress, targetAddress, amountToSendSatoshi.muln(2), undefined, undefined, toBN(100), startBlockHeight + 2, undefined, feeWalletAddress, toBN(100));
        await waitForTxToFinishWithStatus(2, 30, wClient.rootEm, TransactionStatus.TX_FAILED, id);
    });

    it("Transaction with fee too high for fee wallet should be tried with main wallet", async () => {
        // Transaction size is 276.5 (3 inputs + 2 outputs) > 100 (maxFee)
        const startBlockHeight = await wClient.blockchainAPI.getCurrentBlockHeight();
        const id = await wClient.createPaymentTransaction(fundedAddress, targetAddress, amountToSendSatoshi.muln(2), undefined, undefined, toBN(500), startBlockHeight + 2, undefined, feeWalletAddress, toBN(100));
        const [txEnt,] = await waitForTxToFinishWithStatus(2, 30, wClient.rootEm, TransactionStatus.TX_SUCCESS, id);

        const tr = JSON.parse(txEnt.raw!) as UTXORawTransaction;
        expect(tr.inputs.map(t => t.script !== "00143cbd2641a036e99579b5386b13a8c303f3b1cf0e").length).to.be.eq(0); // funded wallet script (fee wallet has a different one)
    });

    it("RBF transaction should be successfully created even if fee > maxFee", async () => {
        const startBlockHeight = await wClient.blockchainAPI.getCurrentBlockHeight();
        const id = await wClient.createPaymentTransaction(fundedAddress, targetAddress, amountToSendSatoshi.muln(2), undefined, undefined, toBN(100), startBlockHeight + 2);
        const txEnt = await fetchTransactionEntityById(wClient.rootEm, id);
        txEnt.rbfReplacementFor = await createAndPersistTransactionEntity(wClient.rootEm, wClient.chainType, fundedAddress, targetAddress, amountToSendSatoshi.muln(2));

        await waitForTxToFinishWithStatus(2, 30, wClient.rootEm, TransactionStatus.TX_SUCCESS, id);
    });
});
