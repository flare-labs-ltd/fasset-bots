import { TransactionStatus, WALLET } from "../../src";
import { DogecoinWalletConfig, FeeServiceConfig, ICreateWalletResponse } from "../../src/interfaces/IWalletTransaction";
import { expect } from "chai";
import { BTC_DOGE_DEC_PLACES, DOGE_DUST_AMOUNT } from "../../src/utils/constants";
import { toBNExp } from "../../src/utils/bnutils";
import { initializeTestMikroORM, ORM } from "../test-orm/mikro-orm.config";
import { UnprotectedDBWalletKeys } from "../test-orm/UnprotectedDBWalletKey";
import {
    addConsoleTransportForTests,
    loop,
    resetMonitoringOnForceExit,
    setMonitoringStatus,
    waitForTxToFinishWithStatus,
} from "../test-util/util";
import BN from "bn.js";
import { logger } from "../../src/utils/logger";
import { sleepMs } from "../../src/utils/utils";
import { ServiceRepository } from "../../src/ServiceRepository";
import { TransactionService } from "../../src/chain-clients/utxo/TransactionService";

const DOGEMccConnectionTestInitial = {
    url: process.env.DOGE_URL ?? "",
    inTestnet: true,
};
const feeServiceConfig: FeeServiceConfig = {
    indexerUrl: process.env.DOGE_URL ?? "",
    sleepTimeMs: 10000,
    numberOfBlocksInHistory: 2,
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

let wClient: WALLET.DOGE;
let fundedWallet: ICreateWalletResponse;
let targetWallet: ICreateWalletResponse;
let testOrm: ORM;

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
            feeServiceConfig: feeServiceConfig,
            enoughConfirmations: 2,
            rateLimitOptions: {
                maxRPS: 100,
                timeoutMs: 2000,
            },
        };
        wClient = await WALLET.DOGE.initialize(DOGEMccConnectionTest);
        await wClient.feeService?.setupHistory();
        void wClient.feeService?.startMonitoringFees();
        void wClient.startMonitoringTransactionProgress();
        resetMonitoringOnForceExit(wClient);
        await sleepMs(500);
    });

    after(async () => {
        await wClient.stopMonitoring();
        try {
            await loop(100, 2000, null, async () => {
                if (!wClient.isMonitoring) return true;
            });
        } catch (e) {
            await setMonitoringStatus(wClient.rootEm, wClient.chainType, 0);
        }
        removeConsoleLogging();
    });

    it("Should not create transaction: amount = dust amount", async () => {
        fundedWallet = wClient.createWalletFromMnemonic(fundedMnemonic);
        await expect(ServiceRepository.get(wClient.chainType, TransactionService).preparePaymentTransaction(0, fundedWallet.address, targetAddress, DOGE_DUST_AMOUNT, feeInSatoshi)).to
            .eventually.be.rejectedWith(`Will not prepare transaction 0, for ${fundedWallet.address}. Amount ${DOGE_DUST_AMOUNT.toString()} is less than dust ${DOGE_DUST_AMOUNT.toString()}`);
    });

    it("Should get account balance", async () => {
        fundedWallet = wClient.createWalletFromMnemonic(fundedMnemonic);
        const accountBalance = await wClient.getAccountBalance(fundedWallet.address);
        expect(accountBalance.gt(new BN(0))).to.be.true;
    });

    it("Should get sub-account balances", async () => {
        const balanceMain = await wClient.getAccountBalance(fundedAddress);
        const balanceSub = await wClient.getAccountBalance(fundedFirstChange.address);
        const balanceMainAndSub = await wClient.getAccountBalance(fundedAddress, [fundedFirstChange.address]);
        expect((balanceSub.add(balanceMain)).eq(balanceMainAndSub)).to.be.true;
    });

    it("Should create delete account transaction", async () => {
        const account = await wClient.createWallet();
        const txId = await wClient.createDeleteAccountTransaction(account.address, "", fundedAddress);
        console.log(txId);
        console.log(account);
        expect(txId).to.be.greaterThan(0);
        const [txEnt, ] = await waitForTxToFinishWithStatus(2, 2 * 60, wClient.rootEm, TransactionStatus.TX_FAILED, txId);
        expect(txEnt.status).to.eq(TransactionStatus.TX_FAILED);
    });
});