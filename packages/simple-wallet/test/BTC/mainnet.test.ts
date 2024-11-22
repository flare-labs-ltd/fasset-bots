import {
    AccountSecrets,
    addConsoleTransportForTests, createNote, createWallet, decryptTestSecrets,
    loop, promptPassword,
    resetMonitoringOnForceExit, waitForTxToFinishWithStatus
} from "../test-util/common_utils";
import {
    BitcoinWalletConfig,
    BTC,
    ITransactionMonitor,
    logger,
    TransactionStatus,
    WalletAddressEntity
} from "../../src";
import { toBN } from "../../src/utils/bnutils";
import config, {initializeMainnetMikroORM, ORM} from "../test-orm/mikro-orm.config";
import { setMonitoringStatus } from "../test-util/entity_utils";
import { expect, use } from "chai";
import chaiAsPromised from "chai-as-promised";
import {DBWalletKeys} from "../test-orm/WalletKeys";

use(chaiAsPromised);

const BTCMccConnectionInitial = {
    urls: [process.env.MAINNET_BTC_URL ?? ""],
    inTestnet: false,
};
let BTCMccConnection: BitcoinWalletConfig;

let fundedAddress: string;
let targetAddress: string;

const enoughConfirmations = 2;
const amountToSendSatoshi = toBN(10020);

let wClient: BTC;
let testOrm: ORM;
let monitor: ITransactionMonitor;

describe("Bitcoin mainnet wallet tests", () => {
    let removeConsoleLogging: () => void;

    before(async () => {
        const password = await promptPassword();
        const testSecrets = await decryptTestSecrets(process.env.TEST_SECRETS_ENCRYPTED_PATH!, password) as AccountSecrets;

        removeConsoleLogging = addConsoleTransportForTests(logger);


        testOrm = await initializeMainnetMikroORM({...config, dbName: "simple-wallet-mainnet-test-db"});
        const dbWalletKeys = new DBWalletKeys(testOrm.em, password);
        BTCMccConnection = {
            ...BTCMccConnectionInitial,
            em: testOrm.em,
            walletKeys: dbWalletKeys,
            enoughConfirmations: 2,
        };
        wClient = BTC.initialize(BTCMccConnection);
        monitor = await wClient.createMonitor();
        await monitor.startMonitoring();
        resetMonitoringOnForceExit(monitor);

        fundedAddress = testSecrets.BTC.fundedWallet.address;
        targetAddress = testSecrets.BTC.targetWallet.address;

        await createWallet(wClient, testSecrets.BTC, "fundedWallet");
        await createWallet(wClient, testSecrets.BTC, "targetWallet");
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

    it("Should successfully created and submit transaction", async () => {
        const note = createNote();
        const sourceBalanceStart = await wClient.getAccountBalance(fundedAddress);
        const targetBalanceStart = await wClient.getAccountBalance(targetAddress);

        const id = await wClient.createPaymentTransaction(fundedAddress, targetAddress, amountToSendSatoshi, undefined, note);
        await waitForTxToFinishWithStatus(2, enoughConfirmations * 10 * 60, wClient.rootEm, TransactionStatus.TX_SUCCESS, id);

        const sourceBalanceEnd = await wClient.getAccountBalance(fundedAddress);
        const targetBalanceEnd = await wClient.getAccountBalance(targetAddress);
        expect(sourceBalanceEnd.lt(sourceBalanceStart)).to.be.true;
        expect(targetBalanceEnd.gt(targetBalanceStart)).to.be.true;
    });

    it("Should submit and replace transaction", async () => {
        const note = createNote();
        const id = await wClient.createPaymentTransaction(fundedAddress, targetAddress, amountToSendSatoshi, undefined, note);
        await waitForTxToFinishWithStatus(2, enoughConfirmations * 10 * 60, wClient.rootEm, TransactionStatus.TX_SUBMITTED, id);

        const blockHeight = await wClient.blockchainAPI.getCurrentBlockHeight();
        await wClient.tryToReplaceByFee(id, blockHeight);

        const [replacedTxEnt,] = await waitForTxToFinishWithStatus(2, enoughConfirmations * 10 * 60, wClient.rootEm, [TransactionStatus.TX_REPLACED_PENDING, TransactionStatus.TX_REPLACED], id);
        await waitForTxToFinishWithStatus(2, enoughConfirmations * 10 * 60, wClient.rootEm, TransactionStatus.TX_SUCCESS, replacedTxEnt.replaced_by!.id);
    });

    it("Should delete account", async () => {
        const sourceBalanceStart = await wClient.getAccountBalance(fundedAddress);
        const id = await wClient.createDeleteAccountTransaction(targetAddress, fundedAddress);
        await waitForTxToFinishWithStatus(2, enoughConfirmations * 10 * 60, wClient.rootEm, TransactionStatus.TX_SUCCESS, id);

        const sourceBalanceEnd = await wClient.getAccountBalance(fundedAddress);
        const targetBalanceEnd = await wClient.getAccountBalance(targetAddress);

        expect(sourceBalanceEnd.gt(sourceBalanceStart)).to.be.true;
        expect(targetBalanceEnd.eqn(0)).to.be.true;
    });

});

