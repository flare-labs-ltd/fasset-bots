import {
    ICreateWalletResponse,
    ITransactionMonitor,
    RippleWalletConfig
} from "../../src/interfaces/IWalletTransaction";
import chaiAsPromised from "chai-as-promised";
import { expect, use } from "chai";
import WAValidator from "wallet-address-validator";
import { XRP_DECIMAL_PLACES } from "../../src/utils/constants";
import { toBN, toBNExp } from "../../src/utils/bnutils";
import {
    createInitialTransactionEntity,
    fetchTransactionEntityById,
    updateTransactionEntity,
} from "../../src/db/dbutils";
import { TransactionStatus } from "../../src/entity/transaction";
import {
    AccountSecretsForStressTest,
    addConsoleTransportForTests,
    loop,
    resetMonitoringOnForceExit,
    waitForTxToBeReplacedWithStatus,
    waitForTxToFinishWithStatus,
} from "../test-util/common_utils";
import { initializeTestMikroORM, ORM } from "../test-orm/mikro-orm.config";
import { UnprotectedDBWalletKeys } from "../test-orm/UnprotectedDBWalletKey";
import { logger } from "../../src/utils/logger";
import { sleepMs } from "../../src/utils/utils";
import { WalletAddressEntity, XRP } from "../../src";
import {
    createAndSignXRPTransactionWithStatus,
    setMonitoringStatus,
    setWalletStatusInDB,
} from "../test-util/entity_utils";
import { ECDSA } from "../../src/chain-clients/account-generation/XrpAccountGeneration";
import sinon from "sinon";
import { XrpWalletImplementation } from "../../src/chain-clients/implementations/XrpWalletImplementation";
import { SubmitTransactionRequest, XRPBlockchainAPI } from "../../src/blockchain-apis/XRPBlockchainAPI";
import fs from "fs";
import xrpl from "xrpl";


use(chaiAsPromised);

const XRPMccConnectionTestInitial = {
    urls: [process.env.XRP_URL ?? ""],
    username: "",
    password: "",
    stuckTransactionOptions: {
        blockOffset: 10,
    },
    rateLimitOptions: {
        timeoutMs: 60000,
    },
    inTestnet: true
};
let XRPMccConnectionTest: RippleWalletConfig;

const fundedSeed = "sannPkA1sGXzM1MzEZBjrE1TDj4Fr";
const fundedAddress = "rpZ1bX5RqATDiB7iskGLmspKLrPbg5X3y8";
const targetMnemonic = "involve essay clean frequent stumble cheese elite custom athlete rack obey walk";
const targetAddress = "r4CrUeY9zcd4TpndxU5Qw9pVXfobAXFWqq";

const amountToSendDropsFirst = toBNExp(0.1, XRP_DECIMAL_PLACES);
const amountToSendDropsSecond = toBNExp(0.05, XRP_DECIMAL_PLACES);
const feeInDrops = toBNExp(0.000015, 6);
const maxFeeInDrops = toBNExp(0.000012, 6);
const note = "10000000000000000000000000000000000000000beefbeaddeafdeaddeedcab";

let wClient: XRP;
let fundedWallet: ICreateWalletResponse; //testnet, seed: sannPkA1sGXzM1MzEZBjrE1TDj4Fr, account: rpZ1bX5RqATDiB7iskGLmspKLrPbg5X3y8
let targetWallet: ICreateWalletResponse; //testnet, account: r4CrUeY9zcd4TpndxU5Qw9pVXfobAXFWqq
let testOrm: ORM;
let unprotectedDBWalletKeys: UnprotectedDBWalletKeys;
let monitor: ITransactionMonitor;

describe("Xrp wallet tests", () => {
    let removeConsoleTransport: () => void;

    before(async () => {
        removeConsoleTransport = addConsoleTransportForTests(logger);

        testOrm = await initializeTestMikroORM();
        unprotectedDBWalletKeys = new UnprotectedDBWalletKeys(testOrm.em);
        XRPMccConnectionTest = { ...XRPMccConnectionTestInitial, em: testOrm.em, walletKeys: unprotectedDBWalletKeys };
        wClient = XRP.initialize(XRPMccConnectionTest);
        monitor = await wClient.createMonitor();
        await monitor.startMonitoring();
        await sleepMs(2000);
        resetMonitoringOnForceExit(monitor);

        fundedWallet = wClient.createWalletFromSeed(fundedSeed, ECDSA.secp256k1);
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

        removeConsoleTransport();
    });

    it("Monitoring should be running", async () => {
        const monitoring = monitor.isMonitoring();
        expect(monitoring).to.be.true;
    });

    it("Should create delete account transaction", async () => {
        const account = wClient.createWallet();
        await wClient.walletKeys.addKey(account.address, account.privateKey);
        const id = await wClient.createPaymentTransaction(fundedAddress, account.address, toBNExp(10, XRP_DECIMAL_PLACES));
        expect(id).to.be.gt(0);
        await waitForTxToFinishWithStatus(2, 100, wClient.rootEm, TransactionStatus.TX_SUCCESS, id);
        const txId = await wClient.createDeleteAccountTransaction(account.address, fundedAddress);
        expect(txId).to.be.greaterThan(0);
        // cannot receive requests already deleting
        await expect(
            wClient.createDeleteAccountTransaction(account.address, fundedAddress)
        ).to.eventually.be.rejectedWith(`Cannot receive requests. ${account.address} is deleting`);
        const txEnt = await waitForTxToFinishWithStatus(2, 2 * 60, wClient.rootEm, TransactionStatus.TX_PREPARED, txId);
        expect(txEnt.status).to.eq(TransactionStatus.TX_PREPARED);
        await updateTransactionEntity(wClient.rootEm, txId, (txEnt) => {
            txEnt.status = TransactionStatus.TX_FAILED;
        });
    });

    it("Should get public key from private key", async () => {
        const seed0 = "sh8N3CZNMqdjBhgsbdzp8NoEnr8MH";
        const seed1 = "sEdTcEtUFE7BxDKj5QfdgyGorRKmq73";
        const wallet0 = wClient.createWalletFromSeed(seed0, ECDSA.secp256k1);
        const wallet1 = wClient.createWalletFromSeed(seed1, ECDSA.ed25519);

        const wallet = new XrpWalletImplementation(XRPMccConnectionTest, {});
        const public0 = (wallet as any).getPublicKeyFromPrivateKey(wallet0.privateKey, wallet0.address);
        const public1 = (wallet as any).getPublicKeyFromPrivateKey(wallet1.privateKey, wallet1.address);
        expect(wallet0.publicKey).to.eq(public0);
        expect(wallet1.publicKey).to.eq(public1);
    });

    it("Should submit transaction", async () => {
        const id = await wClient.createPaymentTransaction(fundedAddress, targetAddress, amountToSendDropsFirst, undefined, note, undefined);
        expect(id).to.be.gt(0);
        await waitForTxToFinishWithStatus(2, 100, wClient.rootEm, TransactionStatus.TX_SUCCESS, id);
    });

    it("Should not validate submit and resubmit transaction - fee to low", async () => {
        const lowFee = toBN(0);
        const id = await wClient.createPaymentTransaction(fundedAddress, targetAddress, amountToSendDropsFirst, lowFee, note);
        expect(id).to.be.gt(0);

        const tx = await waitForTxToBeReplacedWithStatus(2, 100, wClient, TransactionStatus.TX_FAILED, id);
        expect(tx.status).to.equal(TransactionStatus.TX_REPLACED);
    });

    it("Should create transaction with fee", async () => {
        const note = "Submit";
        const trId = await wClient.createPaymentTransaction(
            fundedAddress,
            targetAddress,
            amountToSendDropsSecond,
            feeInDrops,
            note,
            undefined,
        );
        const txEnt = await fetchTransactionEntityById(wClient.rootEm, trId);
        expect(txEnt.source).to.equal(fundedWallet.address);
        expect(txEnt.destination).to.equal(targetAddress);
        expect(txEnt.fee?.toString()).to.equal(feeInDrops.toString());
        expect(txEnt.reference).to.equal(note);

        await waitForTxToFinishWithStatus(2, 100, wClient.rootEm, TransactionStatus.TX_SUCCESS, txEnt.id);
    });

    it("Should not submit transaction: fee > maxFee", async () => {
        const id = await wClient.createPaymentTransaction(fundedAddress, targetAddress, amountToSendDropsSecond, feeInDrops, "Submit", maxFeeInDrops);
        expect(id).to.be.gt(0);

        const tx = await waitForTxToFinishWithStatus(2, 30, wClient.rootEm, TransactionStatus.TX_FAILED, id);
        expect(tx.maxFee!.lt(tx.fee!)).to.be.true;
    });

    it("Should receive fee", async () => {
        const feeP = await wClient.getCurrentTransactionFee({ isPayment: true });
        expect(feeP).not.to.be.null;
        const fee = await wClient.getCurrentTransactionFee({ isPayment: false });
        expect(fee).not.to.be.null;
        expect(fee.gt(feeP)).to.be.true;
    });

    it("Should receive latest validated ledger index", async () => {
        const index = await wClient.getLatestValidatedLedgerIndex();
        expect(index).not.to.be.null;
    });

    it("Should not submit resubmitted transaction - fee to low", async () => {
        const lowFee = toBN(2);
        const maxFee = toBN(3);
        const id = await wClient.createPaymentTransaction(fundedAddress, targetAddress, amountToSendDropsFirst, lowFee, note, maxFee);
        expect(id).to.be.gt(0);

        const txEnt = await waitForTxToFinishWithStatus(2, 30, wClient.rootEm, TransactionStatus.TX_FAILED, id);
        expect(txEnt.replaced_by).to.be.null;
        expect(txEnt.maxFee!.lt(txEnt.fee!.muln(wClient.feeIncrease))).to.be.true;
    });

    // Running this takes cca 20 min, as account can only be deleted
    // if account sequence + DELETE_ACCOUNT_OFFSET < ledger number
    it.skip("Should create and delete account", async () => {
        const toDelete = wClient.createWallet();
        await wClient.walletKeys.addKey(toDelete.address, toDelete.privateKey);
        expect(toDelete.address).to.not.be.null;
        expect(WAValidator.validate(toDelete.address, "XRP", "testnet")).to.be.true;
        expect(WAValidator.validate(fundedWallet.address, "XRP", "testnet")).to.be.true;
        const toSendInDrops = toBNExp(20, 6); // 20 XPR
        // fund toDelete account
        const id = await wClient.createPaymentTransaction(fundedAddress, toDelete.address, toSendInDrops);

        await waitForTxToFinishWithStatus(2, 30, wClient.rootEm, TransactionStatus.TX_SUCCESS, id);
        const balance = await wClient.getAccountBalance(toDelete.address);
        // delete toDelete account
        const id2 = await wClient.createDeleteAccountTransaction(toDelete.address, fundedWallet.address);

        await waitForTxToFinishWithStatus(2, 30, wClient.rootEm, TransactionStatus.TX_SUCCESS, id2);
        const balance2 = await wClient.getAccountBalance(toDelete.address);
        expect(balance.gt(balance2));
    });

    it("Should receive account balance is 0", async () => {
        const newAccount = wClient.createWallet();
        const bn = await wClient.getAccountBalance(newAccount.address);
        expect(bn).to.not.be.null;
        expect(bn.toNumber()).to.be.equal(0);

        const bn2 = await wClient.getAccountBalance("x");
        expect(bn2).to.not.be.null;
        expect(bn2.toNumber()).to.be.equal(0);
    });

    it("Should successfully resubmit transaction with fee < minFee", async () => {
        const lowFee = toBN("5"); // toBN("10") is minFee for XRP
        const id = await wClient.createPaymentTransaction(fundedAddress, targetAddress, amountToSendDropsFirst, lowFee, note);
        expect(id).to.be.gt(0);

        const txEnt = await waitForTxToBeReplacedWithStatus(2, 100, wClient, TransactionStatus.TX_SUCCESS, id);
        expect(txEnt.status).to.equal(TransactionStatus.TX_REPLACED);
    });

    it("Should handle TX_PENDING", async () => {
        const txEnt = await createAndSignXRPTransactionWithStatus(wClient, fundedWallet.address,
            targetAddress, amountToSendDropsFirst, note, feeInDrops, TransactionStatus.TX_PENDING);

        const tx = await waitForTxToBeReplacedWithStatus(2, 100, wClient, TransactionStatus.TX_SUCCESS, txEnt.id);

        expect(tx!.status).to.equal(TransactionStatus.TX_REPLACED);
        expect(!!tx!.replaced_by).to.be.true;
    });

    it("Should not resubmit TX_PENDING - already on chain", async () => {
        const id = await wClient.createPaymentTransaction(fundedAddress, targetAddress, amountToSendDropsFirst, feeInDrops, note);
        await waitForTxToFinishWithStatus(2, 100, wClient.rootEm, TransactionStatus.TX_SUCCESS, id);

        expect((await wClient.getTransactionInfo(id)).status).to.equal(TransactionStatus.TX_SUCCESS);
        await updateTransactionEntity(wClient.rootEm, id, (txEnt) => {
            txEnt.status = TransactionStatus.TX_PENDING;
        });
        expect((await wClient.getTransactionInfo(id)).status).to.equal(TransactionStatus.TX_PENDING);

        const txEnt = await waitForTxToFinishWithStatus(2, 100, wClient.rootEm, TransactionStatus.TX_SUCCESS, id);
        expect(txEnt.status).to.equal(TransactionStatus.TX_SUCCESS);
        expect(txEnt.replaced_by).to.be.null;
    });

    it("Should handle TX_FAILED_SUBMISSION", async () => {
        const txEnt = await createAndSignXRPTransactionWithStatus(wClient, fundedWallet.address,
            targetAddress, amountToSendDropsFirst, note, feeInDrops, TransactionStatus.TX_SUBMISSION_FAILED);

        let txInfo = await wClient.getTransactionInfo(txEnt.id);
        expect(txInfo.status).to.equal(TransactionStatus.TX_SUBMISSION_FAILED);

        const tx = await waitForTxToBeReplacedWithStatus(2, 100, wClient, TransactionStatus.TX_SUCCESS, txEnt.id);
        expect(tx.status).to.equal(TransactionStatus.TX_REPLACED);
        expect(!!tx.replaced_by).to.be.true;
    });

    it("Should submit TX_PREPARED that are in DB", async () => {
        const txEnt = await createAndSignXRPTransactionWithStatus(wClient, fundedWallet.address,
            targetAddress, amountToSendDropsFirst, note, feeInDrops, TransactionStatus.TX_PREPARED);

        const tx = await fetchTransactionEntityById(wClient.rootEm, txEnt.id);
        expect(tx.status).to.equal(TransactionStatus.TX_PREPARED);

        await waitForTxToFinishWithStatus(2, 100, wClient.rootEm, TransactionStatus.TX_SUCCESS, txEnt.id);
    });

    it("Transaction with executeUntilBlock before current ledger index should fail", async () => {
        const currentBlock = await wClient.getLatestValidatedLedgerIndex();
        const id = await wClient.createPaymentTransaction(
            fundedAddress, targetAddress, amountToSendDropsFirst, feeInDrops,
            note, maxFeeInDrops, currentBlock - 5);

        await waitForTxToFinishWithStatus(2, 100, wClient.rootEm, TransactionStatus.TX_FAILED, id);
    });

    it("Transaction with executeUntilBlock too low should fail", async () => {
        const currentBlock = await wClient.getLatestValidatedLedgerIndex();
        const id = await wClient.createPaymentTransaction(
            fundedAddress, targetAddress, amountToSendDropsFirst, maxFeeInDrops,
            note, maxFeeInDrops, currentBlock + 1);

        await waitForTxToFinishWithStatus(2, 100, wClient.rootEm, TransactionStatus.TX_FAILED, id);
    });

    it("Account that is deleting should not be enable to create transactions", async () => {
        const wallet = wClient.createWallet();
        await wClient.walletKeys.addKey(wallet.address, wallet.privateKey);

        await setWalletStatusInDB(wClient.rootEm, wallet.address, true);
        await expect(
            wClient.createPaymentTransaction(wallet.address, targetAddress, amountToSendDropsFirst, feeInDrops, note, maxFeeInDrops),
        ).to.eventually.be.rejectedWith(`Cannot receive requests. ${wallet.address} is deleting`);

        await expect(
            wClient.createDeleteAccountTransaction(wallet.address, targetAddress, amountToSendDropsFirst),
        ).to.eventually.be.rejectedWith(`Cannot receive requests. ${wallet.address} is deleting`);

        await setWalletStatusInDB(wClient.rootEm, wallet.address, false);
        await wClient.rootEm.nativeDelete(WalletAddressEntity, {address: wallet.address});
    });

    it("Account that has missing private key should not enable creating transaction", async () => {
        const wallet = wClient.createWallet();
        await expect(
            wClient.createPaymentTransaction(wallet.address, targetAddress, amountToSendDropsFirst, feeInDrops, note, maxFeeInDrops),
        ).to.eventually.be.rejectedWith(`Cannot prepare transaction ${wallet.address}. Missing private key.`);

        await expect(
            wClient.createDeleteAccountTransaction(wallet.address, targetAddress, amountToSendDropsFirst),
        ).to.eventually.be.rejectedWith(`Cannot prepare transaction ${wallet.address}. Missing private key.`);
        await wClient.rootEm.nativeDelete(WalletAddressEntity, {address: wallet.address});
    });

    it("Account balance should change after transaction", async () => {
        const id = await wClient.createPaymentTransaction(fundedAddress, targetAddress, amountToSendDropsFirst, feeInDrops, note);

        const balanceStart = await wClient.getAccountBalance(fundedAddress);
        expect(balanceStart.toNumber()).to.be.gt(0);

        await waitForTxToFinishWithStatus(2, 100, wClient.rootEm, TransactionStatus.TX_SUCCESS, id);
        const balanceEnd = await wClient.getAccountBalance(fundedAddress);
        expect(balanceStart.sub(balanceEnd).sub(feeInDrops).toNumber()).to.be.equal(amountToSendDropsFirst.toNumber());
    });

    it("If blockchain submission API fails transaction's status should be set to TX_PENDING and resent", async () => {
        sinon.stub(XRPBlockchainAPI.prototype, "submitTransaction").callsFake((params: SubmitTransactionRequest) => {
            throw new Error("Api Down")
        });
        await sleepMs(100);
        const blockHeight = await wClient.getLatestValidatedLedgerIndex();
        const id = await wClient.createPaymentTransaction(fundedAddress, targetAddress, amountToSendDropsFirst, undefined, undefined, undefined, blockHeight + 20);
        const txEnt = await waitForTxToFinishWithStatus(0.01, 100, wClient.rootEm, TransactionStatus.TX_PENDING, id);
        expect(txEnt.status).to.eq(TransactionStatus.TX_PENDING);
        sinon.restore();
        await waitForTxToBeReplacedWithStatus(2, 100, wClient, TransactionStatus.TX_SUCCESS, id);
    });

    it("Free underlying with unspecified fee", async () => {
        const txId = await wClient.createPaymentTransaction(
            fundedAddress, targetAddress, amountToSendDropsFirst, undefined,
            undefined, undefined, undefined, undefined, true
        );

        const txEnt = await waitForTxToFinishWithStatus(2, 100, wClient.rootEm, TransactionStatus.TX_SUCCESS, txId);
        const tr = JSON.parse(txEnt.raw!);
        expect((toBN(tr.Fee).add(toBN(tr.Amount))).eq(txEnt.amount!)).to.be.true;
    });

    it("Free underlying with specified fee", async () => {
        const txId = await wClient.createPaymentTransaction(
            fundedAddress, targetAddress, amountToSendDropsFirst, feeInDrops,
            undefined, undefined, undefined, undefined, true
        );

        const txEnt = await waitForTxToFinishWithStatus(2, 100, wClient.rootEm, TransactionStatus.TX_SUCCESS, txId);
        const tr = JSON.parse(txEnt.raw!);
        expect((toBN(tr.Fee).add(toBN(tr.Amount))).eq(txEnt.amount!)).to.be.true;
    });

    it("Free underlying with a too low fee should be resubmitted", async () => {
        const amount = amountToSendDropsFirst;
        const lowFee = toBN("5"); // toBN("10") is minFee for XRP
        const id = await wClient.createPaymentTransaction(fundedAddress, targetAddress, amount, lowFee, undefined, undefined, undefined, undefined, true);
        expect(id).to.be.gt(0);

        const txEnt = await waitForTxToBeReplacedWithStatus(2, 100, wClient, TransactionStatus.TX_SUCCESS, id);
        expect(txEnt.status).to.equal(TransactionStatus.TX_REPLACED);
        const transaction = JSON.parse(txEnt.replaced_by!.raw!) as xrpl.Payment;
        const fee = lowFee.muln(wClient.feeIncrease);
        expect(toBN(transaction.Amount.toString()).eq(amount.sub(fee))).to.be.true;
    });

    it.skip("Stress test", async () => {
        const file = fs.readFileSync(process.env.TESTNET_STRESS_TEST_SECRETS_PATH!).toString();
        const testSecrets = JSON.parse(file) as AccountSecretsForStressTest;

        const N = 10;

        const transactionIds = [];
        for (let i = 0; i < N; i++) {
            const wallet = testSecrets.XRP.targetWallets[i];
            await wClient.walletKeys.addKey(wallet.address, wallet.private_key);
            const balance = await wClient.getAccountBalance(wallet.address);
            const amount = balance.gt(toBNExp(10, XRP_DECIMAL_PLACES)) ? amountToSendDropsFirst.muln(4) : amountToSendDropsFirst.muln(4).add(toBNExp(10, XRP_DECIMAL_PLACES));
            transactionIds.push(await wClient.createPaymentTransaction(fundedAddress, wallet.address, amount));
        }

        await Promise.all(transactionIds.map(async (t) => await waitForTxToFinishWithStatus(2, 240, wClient.rootEm, TransactionStatus.TX_SUCCESS, t)));

        const transferTransactionIds = [];
        for (let i = 1; i < N; i++) {
            const id1 = await wClient.createPaymentTransaction(testSecrets.XRP.targetWallets[i].address, fundedAddress, amountToSendDropsFirst);
            const id2 = await wClient.createPaymentTransaction(testSecrets.XRP.targetWallets[i].address, fundedAddress, amountToSendDropsFirst);
            const id3 = await wClient.createPaymentTransaction(testSecrets.XRP.targetWallets[i].address, fundedAddress, amountToSendDropsFirst);
            transferTransactionIds.push(id1, id2, id3)
        }
        await Promise.all(transferTransactionIds.map(async (t) => await waitForTxToFinishWithStatus(2, 240, wClient.rootEm, TransactionStatus.TX_SUCCESS, t)));
    });

    it("Should fail - no privateKey ", async () => {
        const account = wClient.createWallet();
        await monitor.stopMonitoring();
        await sleepMs(20000);

        const txEnt0 = await createInitialTransactionEntity(wClient.rootEm, wClient.chainType, account.address, targetAddress, amountToSendDropsFirst);
        const id0 = txEnt0.id;
        await updateTransactionEntity(wClient.rootEm, id0, (txEntToUpdate) => {
            txEntToUpdate.raw = JSON.stringify({raw: 0});
        })
        const txEntBefore0 = await fetchTransactionEntityById(wClient.rootEm, id0);
        await wClient.resubmitSubmissionFailedTransactions(txEntBefore0);
        const txEntAfter0 = await fetchTransactionEntityById(wClient.rootEm, id0);
        expect(txEntAfter0.status).to.eq(TransactionStatus.TX_FAILED);

        const txEnt2 = await createInitialTransactionEntity(wClient.rootEm, wClient.chainType, account.address, targetAddress, amountToSendDropsFirst);
        const id1 = txEnt2.id;
        await updateTransactionEntity(wClient.rootEm, id1, (txEntToUpdate) => {
            txEntToUpdate.raw = JSON.stringify({raw: 0});
        })
        const txEntBefore1 = await fetchTransactionEntityById(wClient.rootEm, id1);
        await wClient.resubmitPendingTransaction(txEntBefore1);
        const txEntAfter1 = await fetchTransactionEntityById(wClient.rootEm, id1);
        expect(txEntAfter1.status).to.eq(TransactionStatus.TX_FAILED);

        const txEnt3 = await createInitialTransactionEntity(wClient.rootEm, wClient.chainType, account.address, targetAddress, amountToSendDropsFirst);
        const id2 = txEnt3.id;
        await updateTransactionEntity(wClient.rootEm, id2, (txEntToUpdate) => {
            txEntToUpdate.raw = JSON.stringify({raw: 0});
        })
        const txEntBefore2 = await fetchTransactionEntityById(wClient.rootEm, id2);
        await wClient.submitPreparedTransactions(txEntBefore2);
        const txEntAfter2 = await fetchTransactionEntityById(wClient.rootEm, id2);
        expect(txEntAfter2.status).to.eq(TransactionStatus.TX_FAILED);
    });
});
