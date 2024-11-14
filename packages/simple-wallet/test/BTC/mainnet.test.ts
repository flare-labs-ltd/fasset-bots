import {
    AccountSecrets,
    addConsoleTransportForTests,
    loop, promptPassword,
    resetMonitoringOnForceExit, waitForTxToFinishWithStatus
} from "../test-util/common_utils";
import {BitcoinWalletConfig, BTC, logger, TransactionStatus} from "../../src";
import {toBN} from "../../src/utils/bnutils";
import {initializeTestMikroORM, ORM} from "../test-orm/mikro-orm.config";
import {UnprotectedDBWalletKeys} from "../test-orm/UnprotectedDBWalletKey";
import {setMonitoringStatus} from "../test-util/entity_utils";
import {expect, use} from "chai";
import {UTXOBlockchainAPI} from "../../src/blockchain-apis/UTXOBlockchainAPI";
import * as dbutils from "../../src/db/dbutils";
import {decryptTestSecrets} from "../test-util/encryption_utils";
import chaiAsPromised from "chai-as-promised";

use(chaiAsPromised);

const BTCMccConnectionInitial = {
    urls: [process.env.MAINNET_BTC_URL ?? ""],
    inTestnet: true, // TODO: Change when we get actual addresses
};
let BTCMccConnection: BitcoinWalletConfig;

let fundedAddress: string;
let targetAddress: string;

const amountToSendSatoshi = toBN(100020);

let wClient: BTC;
let testOrm: ORM;

describe("Bitcoin wallet tests", () => {
    let removeConsoleLogging: () => void;

    before(async () => {
        const password = await promptPassword();
        const testSecrets = await decryptTestSecrets(process.env.TEST_SECRETS_ENCRYPTED_PATH!, password) as AccountSecrets;

        removeConsoleLogging = addConsoleTransportForTests(logger);

        testOrm = await initializeTestMikroORM();
        const unprotectedDBWalletKeys = new UnprotectedDBWalletKeys(testOrm.em);
        BTCMccConnection = {
            ...BTCMccConnectionInitial,
            em: testOrm.em,
            walletKeys: unprotectedDBWalletKeys,
            enoughConfirmations: 2,
        };
        wClient = BTC.initialize(BTCMccConnection);
        void wClient.startMonitoringTransactionProgress();
        resetMonitoringOnForceExit(wClient);

        fundedAddress = testSecrets["fundedWallet"].address!;
        targetAddress = testSecrets["targetWallet"].address!;

        await createWallet(testSecrets, "fundedWallet");
        await createWallet(testSecrets, "targetWallet");
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

    it("Should successfully created and submit transaction", async () => {
        const sourceBalanceStart = await wClient.getAccountBalance(fundedAddress);
        const targetBalanceStart = await wClient.getAccountBalance(targetAddress);

        const id = await wClient.createPaymentTransaction(fundedAddress, targetAddress, amountToSendSatoshi);
        await waitForTxToFinishWithStatus(2, 15 * 60, wClient.rootEm, TransactionStatus.TX_SUCCESS, id);

        const sourceBalanceEnd = await wClient.getAccountBalance(fundedAddress);
        const targetBalanceEnd = await wClient.getAccountBalance(targetAddress);
        expect(sourceBalanceEnd.lt(sourceBalanceStart)).to.be.true;
        expect(targetBalanceEnd.gt(targetBalanceStart)).to.be.true;
    });

    it("Should submit and replace transaction", async () => {
        const id = await wClient.createPaymentTransaction(fundedAddress, targetAddress, amountToSendSatoshi);
        await waitForTxToFinishWithStatus(2, 15 * 60, wClient.rootEm, TransactionStatus.TX_SUBMITTED, id);

        const blockHeight = await wClient.blockchainAPI.getCurrentBlockHeight();
        await wClient.tryToReplaceByFee(id, blockHeight);
        await waitForTxToFinishWithStatus(2, 15 * 60, wClient.rootEm, TransactionStatus.TX_REPLACED, id);

        const txEnt = await dbutils.fetchTransactionEntityById(wClient.rootEm, id);
        await waitForTxToFinishWithStatus(2, 15 * 60, wClient.rootEm, TransactionStatus.TX_SUCCESS, txEnt.replaced_by!.id);
    });

    it("Should delete account", async () => {
        const sourceBalanceStart = await wClient.getAccountBalance(fundedAddress);
        const id = await wClient.createDeleteAccountTransaction(targetAddress, fundedAddress);
        await waitForTxToFinishWithStatus(2, 15 * 60, wClient.rootEm, TransactionStatus.TX_SUCCESS, id);

        const sourceBalanceEnd = await wClient.getAccountBalance(fundedAddress);
        const targetBalanceEnd = await wClient.getAccountBalance(targetAddress);

        expect(sourceBalanceEnd.lt(sourceBalanceStart)).to.be.true;
        expect(targetBalanceEnd.eqn(0)).to.be.true;
    });

    async function createWallet(secrets: any, wallet: "fundedWallet" | "targetWallet") {
        if (secrets["fundedWallet"].privateKey) {
            await wClient.walletKeys.addKey(fundedAddress, secrets["fundedWallet"].privateKey);
        } else if (secrets["fundedWallet"].mnemonic) {
            const wallet = wClient.createWalletFromMnemonic(secrets["fundedWallet"].mnemonic);
            await wClient.walletKeys.addKey(wallet.address, wallet.privateKey);
        } else {
            throw new Error(`Both mnemonic and private key missing for ${wallet}`);
        }
    }
});
