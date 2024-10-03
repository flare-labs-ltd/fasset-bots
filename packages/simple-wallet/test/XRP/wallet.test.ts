import { WALLET } from "../../src";
import { ICreateWalletResponse, RippleWalletConfig } from "../../src/interfaces/IWalletTransaction";
import chaiAsPromised from "chai-as-promised";
import { expect, use } from "chai";
import WAValidator from "wallet-address-validator";
import rewire from "rewire";
import { ChainType, DEFAULT_RATE_LIMIT_OPTIONS_XRP, XRP_DECIMAL_PLACES } from "../../src/utils/constants";
import { toBN, toBNExp } from "../../src/utils/bnutils";
import { createInitialTransactionEntity, fetchTransactionEntityById, updateTransactionEntity } from "../../src/db/dbutils";
import { TransactionStatus } from "../../src/entity/transaction";
import {
    addConsoleTransportForTests,
    createAndSignXRPTransactionWithStatus,
    loop,
    resetMonitoringOnForceExit,
    setMonitoringStatus,
    setWalletStatusInDB,
    TEST_WALLET_XRP,
    waitForTxToBeReplacedWithStatus,
    waitForTxToFinishWithStatus,
} from "../test-util/util";
import { initializeTestMikroORM, ORM } from "../test-orm/mikro-orm.config";
import { UnprotectedDBWalletKeys } from "../test-orm/UnprotectedDBWalletKey";
import { logger } from "../../src/utils/logger";
import axiosRateLimit from "../../src/axios-rate-limiter/axios-rate-limit";
import axios, { AxiosError } from "axios";
import { createAxiosConfig } from "../../src/utils/axios-error-utils";
import { ServiceRepository } from "../../src/ServiceRepository";
import { BlockchainAPIWrapper } from "../../src/blockchain-apis/UTXOBlockchainAPIWrapper";
import { sleepMs } from "../../src/utils/utils";

use(chaiAsPromised);

const rewiredXrpWalletImplementation = rewire("../../src/chain-clients/implementations/XrpWalletImplementation");
const rewiredXrpWalletImplementationClass = rewiredXrpWalletImplementation.__get__("XrpWalletImplementation");

const XRPMccConnectionTestInitial = {
    url: process.env.XRP_URL ?? "",
    username: "",
    password: "",
    stuckTransactionOptions: {
        blockOffset: 10,
    },
    rateLimitOptions: {
        timeoutMs: 60000,
    },
    inTestnet: true,
    fallbackAPIs: [
        { url: process.env.XRP_URL ?? "", }
    ]
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

let wClient: WALLET.XRP;
let fundedWallet: ICreateWalletResponse; //testnet, seed: sannPkA1sGXzM1MzEZBjrE1TDj4Fr, account: rpZ1bX5RqATDiB7iskGLmspKLrPbg5X3y8
let targetWallet: ICreateWalletResponse; //testnet, account: r4CrUeY9zcd4TpndxU5Qw9pVXfobAXFWqq
let testOrm: ORM;
let unprotectedDBWalletKeys: UnprotectedDBWalletKeys;

describe("Xrp wallet tests", () => {
    let removeConsoleTransport: () => void;

    before(async () => {
        removeConsoleTransport = addConsoleTransportForTests(logger);

        testOrm = await initializeTestMikroORM();
        unprotectedDBWalletKeys = new UnprotectedDBWalletKeys(testOrm.em);
        XRPMccConnectionTest = { ...XRPMccConnectionTestInitial, em: testOrm.em, walletKeys: unprotectedDBWalletKeys };
        wClient = new WALLET.XRP(XRPMccConnectionTest);
        void wClient.startMonitoringTransactionProgress();
        await sleepMs(2000);
        resetMonitoringOnForceExit(wClient);

        fundedWallet = wClient.createWalletFromSeed(fundedSeed, "ecdsa-secp256k1");
        await wClient.walletKeys.addKey(fundedWallet.address, fundedWallet.privateKey);
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

        removeConsoleTransport();
    });

    it("Monitoring should be running", async () => {
        const monitoring = await wClient.isMonitoring();
        expect(monitoring).to.be.true;
    });

    it("Should create delete account transaction", async () => {
        const account = await wClient.createWallet();
        const id = await wClient.createPaymentTransaction(fundedAddress, account.address, toBNExp(10, XRP_DECIMAL_PLACES));
        expect(id).to.be.gt(0);
        await waitForTxToFinishWithStatus(2, 20, wClient.rootEm, TransactionStatus.TX_SUCCESS, id);
        const txId = await wClient.createDeleteAccountTransaction(account.address, fundedAddress);
        expect(txId).to.be.greaterThan(0);
        // cannot receive requests already deleting
        await expect(
            wClient.createDeleteAccountTransaction(account.address, fundedAddress)
        ).to.eventually.be.rejectedWith(`Cannot receive requests. ${account.address} is deleting`);
        const [txEnt, ] = await waitForTxToFinishWithStatus(2, 2 * 60, wClient.rootEm, TransactionStatus.TX_FAILED, txId);
        expect(txEnt.status).to.eq(TransactionStatus.TX_FAILED);
    });

    it("Should get public key from private key", async () => {
        const seed0 = "sh8N3CZNMqdjBhgsbdzp8NoEnr8MH";
        const seed1 = "sEdTcEtUFE7BxDKj5QfdgyGorRKmq73";
        const wallet0 = wClient.createWalletFromSeed(seed0, "ecdsa-secp256k1");
        const wallet1 = wClient.createWalletFromSeed(seed1, "ed25519");

        const rewired = new rewiredXrpWalletImplementationClass(XRPMccConnectionTest);
        const public0 = rewired.getPublicKeyFromPrivateKey(wallet0.privateKey, wallet0.address);
        const public1 = rewired.getPublicKeyFromPrivateKey(wallet1.privateKey, wallet1.address);
        expect(wallet0.publicKey).to.eq(public0);
        expect(wallet1.publicKey).to.eq(public1);
    });

    it("Should submit transaction", async () => {
        const id = await wClient.createPaymentTransaction(fundedAddress, targetAddress, amountToSendDropsFirst, undefined, note, undefined);
        expect(id).to.be.gt(0);
        await waitForTxToFinishWithStatus(2, 20, wClient.rootEm, TransactionStatus.TX_SUCCESS, id);
    });

    it("Should not validate submit and resubmit transaction - fee to low", async () => {
        const lowFee = toBN(0);
        const id = await wClient.createPaymentTransaction(fundedAddress, targetAddress, amountToSendDropsFirst, lowFee, note);
        expect(id).to.be.gt(0);

        const [tx] = await waitForTxToBeReplacedWithStatus(2, 20, wClient, TransactionStatus.TX_FAILED, id);
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

        await waitForTxToFinishWithStatus(2, 40, wClient.rootEm, TransactionStatus.TX_SUCCESS, txEnt.id);
    });

    it("Should not submit transaction: fee > maxFee", async () => {
        fundedWallet = wClient.createWalletFromSeed(fundedSeed, "ecdsa-secp256k1");
        const id = await wClient.createPaymentTransaction(fundedAddress, targetAddress, amountToSendDropsSecond, feeInDrops, "Submit", maxFeeInDrops);
        expect(id).to.be.gt(0);

        const [tx] = await waitForTxToFinishWithStatus(2, 30, wClient.rootEm, TransactionStatus.TX_FAILED, id);
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
        fundedWallet = wClient.createWalletFromSeed(fundedSeed, "ecdsa-secp256k1");
        const lowFee = toBN(2);
        const maxFee = toBN(3);
        const id = await wClient.createPaymentTransaction(fundedAddress, targetAddress, amountToSendDropsFirst, lowFee, note, maxFee);
        expect(id).to.be.gt(0);

        const [txEnt, txInfo] = await waitForTxToFinishWithStatus(2, 30, wClient.rootEm, TransactionStatus.TX_FAILED, id);
        expect(txInfo.replacedByDdId).to.be.null;
        expect(txEnt.maxFee!.lt(txEnt.fee!.muln(wClient.feeIncrease))).to.be.true;
    });

    // Running this takes cca 20 min, as account can only be deleted
    // if account sequence + DELETE_ACCOUNT_OFFSET < ledger number
    it.skip("Should create and delete account", async () => {
        const toDelete = wClient.createWallet();
        await wClient.walletKeys.addKey(toDelete.address, toDelete.privateKey);
        expect(toDelete.address).to.not.be.null;
        expect(WAValidator.validate(toDelete.address, "XRP", "testnet")).to.be.true;
        fundedWallet = wClient.createWalletFromSeed(fundedSeed, "ecdsa-secp256k1");
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
        fundedWallet = wClient.createWalletFromSeed(fundedSeed, "ecdsa-secp256k1");
        const lowFee = toBN("5"); // toBN("10") is minFee for XRP
        const id = await wClient.createPaymentTransaction(fundedAddress, targetAddress, amountToSendDropsFirst, lowFee, note);
        expect(id).to.be.gt(0);

        const [txEnt] = await waitForTxToBeReplacedWithStatus(2, 40, wClient, TransactionStatus.TX_SUCCESS, id);
        expect(txEnt.status).to.equal(TransactionStatus.TX_REPLACED);
    });

    it("Should handle TX_PENDING", async () => {
        fundedWallet = wClient.createWalletFromSeed(fundedSeed, "ecdsa-secp256k1");
        const txEnt = await createAndSignXRPTransactionWithStatus(wClient, fundedWallet.address,
            targetAddress, amountToSendDropsFirst, note, feeInDrops, TransactionStatus.TX_PENDING);

        let txInfo = await wClient.getTransactionInfo(txEnt.id);
        expect(txInfo.status).to.equal(TransactionStatus.TX_PENDING);
        [, txInfo] = await waitForTxToBeReplacedWithStatus(2, 40, wClient, TransactionStatus.TX_SUCCESS, txEnt.id);

        expect(txInfo!.replacedByDdId);
        expect(txInfo!.status).to.equal(TransactionStatus.TX_REPLACED);
    });

    it("Should not resubmit TX_PENDING - already on chain", async () => {
        fundedWallet = wClient.createWalletFromSeed(fundedSeed, "ecdsa-secp256k1");
        const id = await wClient.createPaymentTransaction(fundedAddress, targetAddress, amountToSendDropsFirst, feeInDrops, note);
        await waitForTxToFinishWithStatus(2, 40, wClient.rootEm, TransactionStatus.TX_SUCCESS, id);

        expect((await wClient.getTransactionInfo(id)).status).to.equal(TransactionStatus.TX_SUCCESS);
        await updateTransactionEntity(wClient.rootEm, id, async (txEnt) => {
            txEnt.status = TransactionStatus.TX_PENDING;
        });
        expect((await wClient.getTransactionInfo(id)).status).to.equal(TransactionStatus.TX_PENDING);

        const [, txInfo] = await waitForTxToFinishWithStatus(2, 40, wClient.rootEm, TransactionStatus.TX_SUCCESS, id);
        expect(txInfo.status).to.equal(TransactionStatus.TX_SUCCESS);
        expect(!txInfo.replacedByDdId).true;
    });

    it("Should handle TX_FAILED_SUBMISSION", async () => {
        fundedWallet = wClient.createWalletFromSeed(fundedSeed, "ecdsa-secp256k1");
        const txEnt = await createAndSignXRPTransactionWithStatus(wClient, fundedWallet.address,
            targetAddress, amountToSendDropsFirst, note, feeInDrops, TransactionStatus.TX_SUBMISSION_FAILED);

        let txInfo = await wClient.getTransactionInfo(txEnt.id);
        expect(txInfo.status).to.equal(TransactionStatus.TX_SUBMISSION_FAILED);

        [, txInfo] = await waitForTxToBeReplacedWithStatus(2, 40, wClient, TransactionStatus.TX_SUCCESS, txEnt.id);
        expect(txInfo.replacedByDdId);
        expect(txInfo.status).to.equal(TransactionStatus.TX_REPLACED);
    });

    it("Should submit TX_PREPARED that are in DB", async () => {
        fundedWallet = wClient.createWalletFromSeed(fundedSeed, "ecdsa-secp256k1");
        const txEnt = await createAndSignXRPTransactionWithStatus(wClient, fundedWallet.address,
            targetAddress, amountToSendDropsFirst, note, feeInDrops, TransactionStatus.TX_PREPARED);

        const tx = await fetchTransactionEntityById(wClient.rootEm, txEnt.id);
        expect(tx.status).to.equal(TransactionStatus.TX_PREPARED);

        await waitForTxToFinishWithStatus(2, 40, wClient.rootEm, TransactionStatus.TX_SUCCESS, txEnt.id);
    });

    it("Transaction with executeUntilBlock before current ledger index should fail", async () => {
        fundedWallet = wClient.createWalletFromSeed(fundedSeed, "ecdsa-secp256k1");
        const currentBlock = await wClient.getLatestValidatedLedgerIndex();
        const id = await wClient.createPaymentTransaction(
            fundedAddress, targetAddress, amountToSendDropsFirst, feeInDrops,
            note, maxFeeInDrops, currentBlock - 5);

        await waitForTxToFinishWithStatus(2, 40, wClient.rootEm, TransactionStatus.TX_FAILED, id);
    });

    it("Transaction with executeUntilBlock too low should fail", async () => {
        fundedWallet = wClient.createWalletFromSeed(fundedSeed, "ecdsa-secp256k1");
        const currentBlock = await wClient.getLatestValidatedLedgerIndex();
        const id = await wClient.createPaymentTransaction(
            fundedAddress, targetAddress, amountToSendDropsFirst, maxFeeInDrops,
            note, maxFeeInDrops, currentBlock + 1);

        await waitForTxToFinishWithStatus(2, 40, wClient.rootEm, TransactionStatus.TX_FAILED, id);
    });

    it("Account that is deleting should not enable creating transaction", async () => {
        fundedWallet = wClient.createWalletFromSeed(fundedSeed, "ecdsa-secp256k1");
        await setWalletStatusInDB(wClient.rootEm, TEST_WALLET_XRP.address, true);
        await expect(
            wClient.createPaymentTransaction(fundedAddress, targetAddress, amountToSendDropsFirst, feeInDrops, note, maxFeeInDrops),
        ).to.eventually.be.rejectedWith(`Cannot receive requests. ${fundedAddress} is deleting`);
        await setWalletStatusInDB(wClient.rootEm, TEST_WALLET_XRP.address, false);
    });

    it("Account balance should change after transaction", async () => {
        fundedWallet = wClient.createWalletFromSeed(fundedSeed, "ecdsa-secp256k1");
        const id = await wClient.createPaymentTransaction(fundedAddress, targetAddress, amountToSendDropsFirst, feeInDrops, note);

        const balanceStart = await wClient.getAccountBalance(fundedAddress);
        expect(balanceStart.toNumber()).to.be.gt(0);

        await waitForTxToFinishWithStatus(2, 40, wClient.rootEm, TransactionStatus.TX_SUCCESS, id);
        const balanceEnd = await wClient.getAccountBalance(fundedAddress);
        expect(balanceStart.sub(balanceEnd).sub(feeInDrops).toNumber()).to.be.equal(amountToSendDropsFirst.toNumber());
    });

    it.skip("Stress test", async () => {
        targetWallet = wClient.createWalletFromMnemonic(targetMnemonic);
        await wClient.walletKeys.addKey(targetWallet.address, targetWallet.privateKey);

        const N_TRANSACTIONS = 10;

        const ids = [];
        for (let i = 0; i < N_TRANSACTIONS; i++) {
            let id;
            if (Math.random() > 0.5) {
                id = await wClient.createPaymentTransaction(fundedAddress, targetAddress, amountToSendDropsFirst, feeInDrops, note);
            } else {
                id = await wClient.createPaymentTransaction(targetWallet.address, fundedWallet.address, amountToSendDropsFirst, feeInDrops, note);
            }
            ids.push(id);
        }

        for (const id of ids) {
            await waitForTxToFinishWithStatus(2, 600, wClient.rootEm, TransactionStatus.TX_SUCCESS, id);
        }
    });

    it("Should successfully use fallback APIs", async () => {
        const url = "https://xrpl-testnet-api.flare.network/";

        wClient.blockchainAPI.clients[url] = axiosRateLimit(
            axios.create(createAxiosConfig(ChainType.testXRP, url)), {
                ...DEFAULT_RATE_LIMIT_OPTIONS_XRP,
            });

        const interceptorId = wClient.blockchainAPI.clients[process.env.XRP_URL ?? ""].interceptors.request.use(
            (config: any) => {
                return Promise.reject(new AxiosError("Simulated connection down", "ECONNABORTED"));
            },
            (error: any) => {
                return Promise.reject(error);
            },
        );

        const balance = await wClient.getAccountBalance(fundedAddress);
        expect(balance.toNumber()).to.be.gt(0);

        wClient.blockchainAPI.clients[process.env.XRP_URL ?? ""].interceptors.request.eject(interceptorId);
        delete wClient.blockchainAPI.clients[url];
    });

    it("Should receive no service found ", async () => {
        const fn = () => {
            return ServiceRepository.get(ChainType.testXRP, BlockchainAPIWrapper).getUTXOsWithoutScriptFromMempool("");
        };
        expect(fn).to.throw("No service registered for testXRP");
    });

    it("Should fail - no privateKey ", async () => {
        const account = wClient.createWallet();
        await wClient.stopMonitoring();
        await sleepMs(20000);
        fundedWallet = wClient.createWalletFromSeed(fundedSeed, "ecdsa-secp256k1");

        const txEnt0 = await createInitialTransactionEntity(wClient.rootEm, wClient.chainType, account.address, targetAddress, amountToSendDropsFirst);
        const id0 = txEnt0.id;
        updateTransactionEntity(wClient.rootEm, id0, async (txEntToUpdate) => {
            txEntToUpdate.raw = JSON.stringify({raw: 0});
        })
        const txEntBefore0 = await fetchTransactionEntityById(wClient.rootEm, id0);
        await wClient.resubmitSubmissionFailedTransactions(txEntBefore0);
        const txEntAfter0 = await fetchTransactionEntityById(wClient.rootEm, id0);
        expect(txEntAfter0.status).to.eq(TransactionStatus.TX_FAILED);

        const txEnt2 = await createInitialTransactionEntity(wClient.rootEm, wClient.chainType, account.address, targetAddress, amountToSendDropsFirst);
        const id1 = txEnt2.id;
        updateTransactionEntity(wClient.rootEm, id1, async (txEntToUpdate) => {
            txEntToUpdate.raw = JSON.stringify({raw: 0});
        })
        const txEntBefore1 = await fetchTransactionEntityById(wClient.rootEm, id1);
        await wClient.resubmitPendingTransaction(txEntBefore1);
        const txEntAfter1 = await fetchTransactionEntityById(wClient.rootEm, id1);
        expect(txEntAfter1.status).to.eq(TransactionStatus.TX_FAILED);

        const txEnt3 = await createInitialTransactionEntity(wClient.rootEm, wClient.chainType, account.address, targetAddress, amountToSendDropsFirst);
        const id2 = txEnt3.id;
        updateTransactionEntity(wClient.rootEm, id2, async (txEntToUpdate) => {
            txEntToUpdate.raw = JSON.stringify({raw: 0});
        })
        const txEntBefore2 = await fetchTransactionEntityById(wClient.rootEm, id2);
        await wClient.submitPreparedTransactions(txEntBefore2);
        const txEntAfter2 = await fetchTransactionEntityById(wClient.rootEm, id2);
        expect(txEntAfter2.status).to.eq(TransactionStatus.TX_FAILED);
    });
});
