import {
    AccountSecrets,
    AccountSecretsForStressTest,
    addConsoleTransportForTests,
    createNote,
    createWallet,
    decryptTestSecrets,
    loop,
    promptPassword,
    resetMonitoringOnForceExit,
    waitForTxToBeReplacedWithStatus,
    waitForTxToFinishWithStatus
} from "../test-util/common_utils";
import {
    ITransactionMonitor,
    logger,
    RippleWalletConfig,
    TransactionStatus,
    WalletAddressEntity,
    XRP
} from "../../src";
import config, { initializeMainnetMikroORM, ORM } from "../test-orm/mikro-orm.config";
import { setMonitoringStatus } from "../test-util/entity_utils";
import { expect, use } from "chai";
import { toBN, toBNExp } from "../../src/utils/bnutils";
import chaiAsPromised from "chai-as-promised";
import { DBWalletKeys } from "../test-orm/WalletKeys";
import { XRP_DECIMAL_PLACES } from "../../src/utils/constants";

use(chaiAsPromised);

const XRPConnectionInitial = {
    urls: [process.env.MAINNET_XRP_URL ?? ""],
    inTestnet: false,
};
let conn: RippleWalletConfig;

let fundedAddress: string;
let targetAddress: string;

const enoughConfirmations = 2;
const amountToSendDrops = toBNExp(10, XRP_DECIMAL_PLACES);

let wClient: XRP;
let testOrm: ORM;
let monitor: ITransactionMonitor;
let stressTestSecrets: AccountSecretsForStressTest;

describe("XRP mainnet wallet tests", () => {
    let removeConsoleLogging: () => void;

    before(async () => {
        const password = await promptPassword();
        const testSecrets = await decryptTestSecrets(process.env.TEST_SECRETS_ENCRYPTED_PATH!, password) as AccountSecrets;
        const passwordForStressTest = await promptPassword(`Enter password for stress test secrets: `);
        stressTestSecrets = await decryptTestSecrets(process.env.STRESS_TEST_SECRETS_ENCRYPTED_PATH!, passwordForStressTest) as AccountSecretsForStressTest;

        const apiKey = testSecrets.XRP.api_key;

        removeConsoleLogging = addConsoleTransportForTests(logger);

        testOrm = await initializeMainnetMikroORM({...config, dbName: "simple-wallet-mainnet-test-db"});
        const dbWalletKeys = new DBWalletKeys(testOrm.em, password);
        conn = {
            ...XRPConnectionInitial,
            em: testOrm.em,
            walletKeys: dbWalletKeys,
            enoughConfirmations: enoughConfirmations,
            apiTokenKeys: [apiKey]
        };
        wClient = XRP.initialize(conn);
        monitor = await wClient.createMonitor();
        await monitor.startMonitoring();
        resetMonitoringOnForceExit(monitor);

        fundedAddress = testSecrets.XRP.fundedWallet.address;
        targetAddress = testSecrets.XRP.targetWallet.address;

        await createWallet(wClient, testSecrets.XRP, "fundedWallet");
        await createWallet(wClient, testSecrets.XRP, "targetWallet");
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

        await wClient.rootEm.nativeDelete(WalletAddressEntity, {});
        wClient.rootEm.clear();
    });

    it("Should successfully create and submit transaction", async () => {
        const note = createNote();
        const toSendInDrops = toBNExp(20, XRP_DECIMAL_PLACES); // 20 XPR for activating account

        const sourceBalanceStart = await wClient.getAccountBalance(fundedAddress);
        const targetBalanceStart = await wClient.getAccountBalance(targetAddress);

        const id = await wClient.createPaymentTransaction(fundedAddress, targetAddress, toSendInDrops, undefined, note);
        await waitForTxToFinishWithStatus(2, enoughConfirmations * 5 * 60, wClient.rootEm, TransactionStatus.TX_SUCCESS, id);

        const sourceBalanceEnd = await wClient.getAccountBalance(fundedAddress);
        const targetBalanceEnd = await wClient.getAccountBalance(targetAddress);
        expect(sourceBalanceEnd.lt(sourceBalanceStart)).to.be.true;
        expect(targetBalanceEnd.gt(targetBalanceStart)).to.be.true;
    });

    it("Should successfully resubmit transaction with fee < minFee", async () => {
        const note = createNote();
        const lowFee = toBN("5"); // toBN("10") is minFee for XRP
        const id = await wClient.createPaymentTransaction(fundedAddress, targetAddress, amountToSendDrops, lowFee, note);
        expect(id).to.be.gt(0);

        const txEnt = await waitForTxToBeReplacedWithStatus(2, 40, wClient, TransactionStatus.TX_SUCCESS, id);
        expect(txEnt.status).to.equal(TransactionStatus.TX_REPLACED);
    });

    it("Stress test", async () => {
        const N = 50;
        const amountToSendDrops = toBNExp(0.2, XRP_DECIMAL_PLACES);
        const xrpReserveAmount = toBNExp(1, XRP_DECIMAL_PLACES);

        const transactionIds = [];
        for (let i = 0; i < N; i++) {
            const wallet = stressTestSecrets.XRP.targetWallets[i];
            await wClient.walletKeys.addKey(wallet.address, wallet.private_key);
            const balance = await wClient.getAccountBalance(wallet.address);
            const amount = balance.gt(xrpReserveAmount) ? amountToSendDrops.muln(3.5) : amountToSendDrops.muln(3.5).add(xrpReserveAmount);

            transactionIds.push(await wClient.createPaymentTransaction(fundedAddress, wallet.address, amount));
        }

        await Promise.all(transactionIds.map(async (t) => await waitForTxToFinishWithStatus(2, 240, wClient.rootEm, TransactionStatus.TX_SUCCESS, t)));

        const transferTransactionIds = [];
        for (let i = 1; i < N; i++) {
            const id1 = await wClient.createPaymentTransaction(stressTestSecrets.XRP.targetWallets[i].address, fundedAddress, amountToSendDrops);
            const id2 = await wClient.createPaymentTransaction(stressTestSecrets.XRP.targetWallets[i].address, fundedAddress, amountToSendDrops);
            const id3 = await wClient.createPaymentTransaction(stressTestSecrets.XRP.targetWallets[i].address, fundedAddress, amountToSendDrops);
            transferTransactionIds.push(id1, id2, id3)
        }
        await Promise.all(transferTransactionIds.map(async (t) => await waitForTxToFinishWithStatus(2, 240, wClient.rootEm, TransactionStatus.TX_SUCCESS, t)));
    });

    it("Stress test - transactions with insufficient fee should be resubmitted", async () => {
        const N = 40;
        const amountToSendDrops = toBNExp(0.2, XRP_DECIMAL_PLACES);
        const xrpReserveAmount = toBNExp(1, XRP_DECIMAL_PLACES);

        const transactionIds = [];
        for (let i = 0; i < N; i++) {
            const wallet = stressTestSecrets.XRP.targetWallets[i];
            await wClient.walletKeys.addKey(wallet.address, wallet.private_key);
            const balance = await wClient.getAccountBalance(wallet.address);
            const amount = balance.gt(xrpReserveAmount) ? amountToSendDrops.muln(3.5) : amountToSendDrops.muln(3.5).add(xrpReserveAmount);

            transactionIds.push(await wClient.createPaymentTransaction(fundedAddress, wallet.address, amount, toBN("5")));
        }

        await Promise.all(transactionIds.map(async (t) => await waitForTxToBeReplacedWithStatus(2, 240, wClient, TransactionStatus.TX_SUCCESS, t)));

        const transferTransactionIds = [];
        for (let i = 1; i < N; i++) {
            const id1 = await wClient.createPaymentTransaction(stressTestSecrets.XRP.targetWallets[i].address, fundedAddress, amountToSendDrops, toBN("5"));
            const id2 = await wClient.createPaymentTransaction(stressTestSecrets.XRP.targetWallets[i].address, fundedAddress, amountToSendDrops, toBN("5"));
            const id3 = await wClient.createPaymentTransaction(stressTestSecrets.XRP.targetWallets[i].address, fundedAddress, amountToSendDrops, toBN("5"));
            transferTransactionIds.push(id1, id2, id3)
        }
        await Promise.all(transferTransactionIds.map(async (t) => await waitForTxToBeReplacedWithStatus(2, 240, wClient, TransactionStatus.TX_SUCCESS, t)));
    });

    it("Should delete account", async () => {
        const sourceBalanceStart = await wClient.getAccountBalance(fundedAddress);
        const id = await wClient.createDeleteAccountTransaction(targetAddress, fundedAddress);
        await waitForTxToFinishWithStatus(2, 25 * 60, wClient.rootEm, TransactionStatus.TX_SUCCESS, id);

        const sourceBalanceEnd = await wClient.getAccountBalance(fundedAddress);
        const targetBalanceEnd = await wClient.getAccountBalance(targetAddress);

        expect(sourceBalanceEnd.gt(sourceBalanceStart)).to.be.true;
        expect(targetBalanceEnd.eqn(0)).to.be.true;
    });

    it("Delete target wallets", async () => {
        const transactionIds = [];
        for (let i = 0; i < stressTestSecrets.XRP.targetWallets.length; i++) {
            const wallet = stressTestSecrets.XRP.targetWallets[i];
            await wClient.walletKeys.addKey(wallet.address, wallet.private_key);
            const balance = await wClient.getAccountBalance(wallet.address);
            if (balance.gtn(0)) {
                transactionIds.push(await wClient.createDeleteAccountTransaction(wallet.address, fundedAddress));
            }
        }

        await Promise.all(transactionIds.map(async (t) => await waitForTxToBeReplacedWithStatus(10, 30 * 60, wClient, TransactionStatus.TX_SUCCESS, t)));
    });

});

