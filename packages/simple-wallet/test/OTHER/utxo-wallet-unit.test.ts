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
import { addConsoleTransportForTests, loop, waitForTxToFinishWithStatus } from "../test-util/common_utils";
import { UTXOWalletImplementation } from "../../src/chain-clients/implementations/UTXOWalletImplementation";
import sinon from "sinon";
import { fetchTransactionEntityById, updateTransactionEntity } from "../../src/db/dbutils";
import {
    createAndPersistTransactionEntity,
    setMonitoringStatus
} from "../test-util/entity_utils";
import { toBN } from "web3-utils";
import BN from "bn.js";
import * as bitcore from "bitcore-lib";
import { expect } from "chai";

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

        sinon.stub(wClient.transactionUTXOService, "getNumberOfMempoolAncestors").resolves(0);
        sinon.stub(wClient.blockchainAPI, "getUTXOsFromMempool").resolves([]);
        sinon.stub(wClient.transactionFeeService, "getFeePerKB").resolves(new BN(1000));
        // sinon.stub(dbutils, "correctUTXOInconsistenciesAndFillFromMempool").resolves();
        sinon.stub(wClient, "signAndSubmitProcess").callsFake(async (txId: number, transaction: bitcore.Transaction, privateKey: string, privateKeyForFee?: string) =>
            await updateTransactionEntity(wClient.rootEm, txId, (txEntToUpdate) => {
                txEntToUpdate.status = TransactionStatus.TX_SUCCESS;
            })
        );

        monitor = await wClient.createMonitor();
        await monitor.startMonitoring();
    });

    beforeEach(() => {
        getBlockHeightStub = sinon.stub(wClient.blockchainAPI, "getCurrentBlockHeight").callsFake(async () => {
            const elapsedSeconds = (Date.now() - startTime) / 1000;
            return startBlockHeight + Math.floor(elapsedSeconds / 5);
        });

        const startTime = Date.now();
    });

    afterEach(() => {
        getBlockHeightStub.restore();
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

    it("Should successfully create transaction with fee < maxFee", async () => {
        // Transaction size is 276.5 (3 inputs + 2 outputs) > 100 (maxFee)
        const id = await wClient.createPaymentTransaction(fundedAddress, targetAddress, amountToSendSatoshi.muln(2), undefined, undefined, toBN(500), startBlockHeight + 2);
        await waitForTxToFinishWithStatus(2, 30, wClient.rootEm, TransactionStatus.TX_SUCCESS, id);
    });

    it("Transaction with too high fee should eventually fail", async () => {
        // Transaction size is 276.5 (3 inputs + 2 outputs) > 100 (maxFee)
        const id = await wClient.createPaymentTransaction(fundedAddress, targetAddress, amountToSendSatoshi.muln(2), undefined, undefined, toBN(100), startBlockHeight + 2);
        await waitForTxToFinishWithStatus(2, 30, wClient.rootEm, TransactionStatus.TX_FAILED, id);
    });

    it("Transaction with fee too high for fee wallet and main wallet should eventually fail", async () => {
        // Transaction size is 276.5 (3 inputs + 2 outputs) > 100 (maxFee)
        const id = await wClient.createPaymentTransaction(fundedAddress, targetAddress, amountToSendSatoshi.muln(2), undefined, undefined, toBN(100), startBlockHeight + 2, undefined, feeWalletAddress, toBN(100));
        await waitForTxToFinishWithStatus(2, 30, wClient.rootEm, TransactionStatus.TX_FAILED, id);
    });
    // TODO
    // it("Transaction with fee too high for fee wallet should be tried with main wallet", async () => {
    //     // Transaction size is 276.5 (3 inputs + 2 outputs) > 100 (maxFee)
    //     const id = await wClient.createPaymentTransaction(fundedAddress, targetAddress, amountToSendSatoshi.muln(2), undefined, undefined, toBN(500), startBlockHeight + 2, undefined, feeWalletAddress, toBN(100));
    //     const [txEnt,] = await waitForTxToFinishWithStatus(2, 30, wClient.rootEm, TransactionStatus.TX_SUCCESS, id);
    //     expect(txEnt.utxos.filter(t => t.source !== fundedAddress).length).to.be.eq(0);
    // });

    it("RBF transaction should be successfully created even if fee > maxFee", async () => {
        const id = await wClient.createPaymentTransaction(fundedAddress, targetAddress, amountToSendSatoshi.muln(2), undefined, undefined, toBN(100), startBlockHeight + 2);
        const txEnt = await fetchTransactionEntityById(wClient.rootEm, id);
        txEnt.rbfReplacementFor = await createAndPersistTransactionEntity(wClient.rootEm, wClient.chainType, fundedAddress, targetAddress, amountToSendSatoshi.muln(2));

        await waitForTxToFinishWithStatus(2, 30, wClient.rootEm, TransactionStatus.TX_SUCCESS, id);
    });

});
