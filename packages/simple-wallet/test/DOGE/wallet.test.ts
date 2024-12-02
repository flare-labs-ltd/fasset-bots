import { DOGE, TransactionStatus } from "../../src";
import { DogecoinWalletConfig, ITransactionMonitor } from "../../src/interfaces/IWalletTransaction";
import chaiAsPromised from "chai-as-promised";
import { expect, use } from "chai";
import { BTC_DOGE_DEC_PLACES, ChainType, DOGE_DUST_AMOUNT } from "../../src/utils/constants";
import { toBN, toBNExp } from "../../src/utils/bnutils";
import { initializeTestMikroORM, ORM } from "../test-orm/mikro-orm.config";
import { UnprotectedDBWalletKeys } from "../test-orm/UnprotectedDBWalletKey";
import {
    addConsoleTransportForTests,
    loop,
    resetMonitoringOnForceExit,
    waitForTxToFinishWithStatus,
} from "../test-util/common_utils";
import BN from "bn.js";
import { logger } from "../../src/utils/logger";
import { getCurrentTimestampInSeconds, sleepMs } from "../../src/utils/utils";
import { fetchTransactionEntityById, updateTransactionEntity } from "../../src/db/dbutils";
import { setMonitoringStatus } from "../test-util/entity_utils";
use(chaiAsPromised);

const DOGEMccConnectionTestInitial = {
    urls: [process.env.DOGE_URL ?? ""],
    inTestnet: true,
};
let DOGEMccConnectionTest: DogecoinWalletConfig;

const fundedMnemonic = "involve essay clean frequent stumble cheese elite custom athlete rack obey walk";
const fundedAddress = "noXb5PiT85PPyQ3WBMLY7BUExm9KpfV93S";
const targetMnemonic = "forum tissue lonely diamond sea invest hill bamboo hamster leaf asset column duck order sock dad beauty valid staff scan hospital pair law cable";
const targetAddress = "npJo8FieqEmB1NehU4jFFEFPsdvy8ippbm";

const fundedFirstChange = {
    xpub: "vpub5ZZjGgAiEbwK4oFTypCwvyHnE7XPFgEHB7iqUqmRrWEnQU9RKLKs6uok1zvwDvdWjmSnNgM2QnTmT477YECcxsxsdJANtdV9qmVfYc39PLS",
    address: "np3gXRRAfJ1fbw3pnkdDR96sbmhEdFjq3v",
    privateKey: "ciCVd1m6gFJ2PTRuWjrmXK2KRBLkY8RzgCJ9pqfmqm1XT6L7pXwM",
};

const targetFirstChange = {
    xpub: "vpub5YEVpE5aqVJiEos7Z1iQgQPcdSM7nfQNB8dfdW7zDGGQrp3MUk2e5aAaCgfsyeQryUHHgxWGteYqkPfCBCpnEGAcqxaFpWAZ7ByJsvXPPzJ",
    address: "nkatKfFLa5wXbtuMHM5vN9qJ3v7UPfkBU9",
    privateKey: "cgAnaNqPmVUr3Am1VAzGX9zGEVw5AJ2FWMYw65dBGnUUJs4iTEkP",
};

const DOGE_DECIMAL_PLACES = BTC_DOGE_DEC_PLACES;
const feeInSatoshi = toBNExp(2, DOGE_DECIMAL_PLACES);

let wClient: DOGE;
let testOrm: ORM;
const chainType = ChainType.testDOGE;
let monitor: ITransactionMonitor;

describe("Dogecoin wallet tests", () => {
    let removeConsoleLogging: () => void;

    before(async () => {
        removeConsoleLogging = addConsoleTransportForTests(logger);
        testOrm = await initializeTestMikroORM();
        const unprotectedDBWalletKeys = new UnprotectedDBWalletKeys(testOrm.em);
        DOGEMccConnectionTest = {
            ...DOGEMccConnectionTestInitial,
            em: testOrm.em,
            walletKeys: unprotectedDBWalletKeys,
            enoughConfirmations: 2,
            rateLimitOptions: {
                maxRPS: 100,
                timeoutMs: 2000,
            },
        };
        wClient = DOGE.initialize(DOGEMccConnectionTest);
        monitor = await wClient.createMonitor();
        await monitor.startMonitoring();
        resetMonitoringOnForceExit(monitor);
        await sleepMs(500);

        const fundedWallet = wClient.createWalletFromMnemonic(fundedMnemonic);
        await wClient.walletKeys.addKey(fundedWallet.address, fundedWallet.privateKey);
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
    });

    it("Should not create transaction: amount = dust amount", async () => {
        await expect(wClient.transactionService.preparePaymentTransaction(0, fundedAddress, targetAddress, DOGE_DUST_AMOUNT, feeInSatoshi)).to
            .eventually.be.rejectedWith(`Will not prepare transaction 0, for ${fundedAddress}. Amount ${DOGE_DUST_AMOUNT.toString()} is less than dust ${DOGE_DUST_AMOUNT.toString()}`);
    });

    it("Should get account balance", async () => {
        const accountBalance = await wClient.getAccountBalance(fundedAddress);
        expect(accountBalance.gt(new BN(0))).to.be.true;
    });

    it("Should create delete account transaction", async () => {
        const account = wClient.createWallet();
        await wClient.walletKeys.addKey(account.address, account.privateKey);
        const txId = await wClient.createDeleteAccountTransaction(account.address, fundedAddress);
        expect(txId).to.be.greaterThan(0);
        const [txEnt, ] = await waitForTxToFinishWithStatus(2, 2 * 60, wClient.rootEm, TransactionStatus.TX_FAILED, txId);
        expect(txEnt.status).to.eq(TransactionStatus.TX_FAILED);
    });

    it("Should check pending transaction", async () => {
        const targetWallet = wClient.createWalletFromMnemonic(targetMnemonic);
        await wClient.walletKeys.addKey(targetWallet.address, targetWallet.privateKey);
        const toSend = toBNExp(10, BTC_DOGE_DEC_PLACES);
        const txId = await wClient.createPaymentTransaction(targetAddress, fundedAddress, toSend);
        expect(txId).to.be.greaterThan(0);
        const txEnt = await fetchTransactionEntityById(wClient.rootEm, txId);

        const [transaction] = await wClient.transactionService.preparePaymentTransaction(
            txEnt.id,
            txEnt.source,
            txEnt.destination,
            txEnt.amount ?? null,
            txEnt.fee,
            txEnt.reference        );

        await updateTransactionEntity(wClient.rootEm, txEnt.id, (txEntToUpdate) => {
            txEntToUpdate.raw = JSON.stringify(transaction);
            txEntToUpdate.status = TransactionStatus.TX_PREPARED;
            txEntToUpdate.reachedStatusPreparedInTimestamp = toBN(getCurrentTimestampInSeconds());
            txEntToUpdate.fee = toBN(transaction.getFee());
            txEntToUpdate.reachedStatusPendingInTimestamp =  toBN(getCurrentTimestampInSeconds());
            txEntToUpdate.executeUntilTimestamp = toBN(getCurrentTimestampInSeconds());
            txEntToUpdate.executeUntilBlock = undefined;
        });
        await wClient.checkPendingTransaction(txEnt);
        expect(txEnt.status).to.eq(TransactionStatus.TX_SUBMITTED);
    });

    it("Should create estimate fee", async () => {
        const fee = await wClient.transactionFeeService.getEstimateFee(1, 3, toBNExp(1, BTC_DOGE_DEC_PLACES));
        expect(fee.gtn(0));
    });
});
