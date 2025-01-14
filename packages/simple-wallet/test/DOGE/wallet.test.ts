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
    bothWalletAddresses,
    loop,
    resetMonitoringOnForceExit,
    waitForTxToFinishWithStatus,
} from "../test-util/common_utils";
import BN from "bn.js";
import { logger } from "../../src/utils/logger";
import { getCurrentTimestampInSeconds, sleepMs } from "../../src/utils/utils";
import { fetchTransactionEntityById, updateTransactionEntity } from "../../src/db/dbutils";
import { createTransactionEntity, setMonitoringStatus } from "../test-util/entity_utils";
import { TEST_DOGE_ACCOUNTS } from "./accounts";

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

const amountToSend = toBNExp(1, BTC_DOGE_DEC_PLACES);

let wClient: DOGE;
let testOrm: ORM;
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
        await testOrm.close();
    });

    it("Should not create transaction: amount = dust amount", async () => {
        await expect(wClient.transactionService.preparePaymentTransaction(0, fundedAddress, targetAddress, DOGE_DUST_AMOUNT)).to
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
        const txEnt = await waitForTxToFinishWithStatus(2, 2 * 60, wClient.rootEm, TransactionStatus.TX_FAILED, txId);
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
            txEnt.reference);

        const currentBlockHeight = await wClient.blockchainAPI.getCurrentBlockHeight();
        await updateTransactionEntity(wClient.rootEm, txEnt.id, (txEntToUpdate) => {
            txEntToUpdate.raw = JSON.stringify(transaction);
            txEntToUpdate.status = TransactionStatus.TX_PREPARED;
            txEntToUpdate.reachedStatusPreparedInTimestamp = toBN(getCurrentTimestampInSeconds());
            txEntToUpdate.fee = toBN(transaction.getFee());
            txEntToUpdate.reachedStatusPendingInTimestamp = toBN(getCurrentTimestampInSeconds());
            txEntToUpdate.executeUntilTimestamp = toBN(getCurrentTimestampInSeconds());
            txEntToUpdate.executeUntilBlock = currentBlockHeight + 100;
        });
        await wClient.checkPendingTransaction(txEnt);
        expect(txEnt.status).to.eq(TransactionStatus.TX_SUBMITTED);
    });

    it("Should create estimate fee", async () => {
        const fee = await wClient.transactionFeeService.getEstimateFee(1, 3, toBNExp(1, BTC_DOGE_DEC_PLACES));
        expect(fee.gtn(0));
    });

    it("Should send multiple transactions", async () => {
        const amount = toBNExp(1, BTC_DOGE_DEC_PLACES);

        const ids = [];
        for (let i = 0; i < 10; i++) {
            const id = await wClient.createPaymentTransaction(fundedAddress, targetAddress, amount);
            ids.push(id);
        }

        await Promise.all(ids.map(t => waitForTxToFinishWithStatus(2, 3 * 60, wClient.rootEm, [TransactionStatus.TX_SUBMITTED], t)));
    });

    it("Should successfully setup the utxoScriptMap and query from it", async () => {
        const addresses = [fundedAddress, targetAddress];

        const mempoolUTXOs = [];
        for (const address of addresses) {
            const utxos = await wClient.blockchainAPI.getUTXOsFromMempool(address);
            await wClient.transactionUTXOService.handleMissingUTXOScripts(utxos, address);
            mempoolUTXOs.push(utxos);
        }

        for (const [i, address] of addresses.entries()) {
            for (const utxo of mempoolUTXOs[i]) {
                expect(utxo.script).to.be.eq(wClient.transactionUTXOService.getUtxoScriptMap().get(address)!.get(`${utxo.transactionHash}:${utxo.position}`));
            }
        }
    });

    it("Should delete UTXO scripts for UTXOs used by transaction that were accepted to blockchain", async () => {
        const addresses = [fundedAddress, targetAddress];

        const mempoolUTXOs = [];
        for (const address of addresses) {
            const utxos = await wClient.blockchainAPI.getUTXOsFromMempool(address);
            await wClient.transactionUTXOService.handleMissingUTXOScripts(utxos, address);
            mempoolUTXOs.push(utxos);
        }

        const txHashes = [
            // fundedAddress
            ["1ebbd9ac0e0d6a27b69a384c97ac5f6f5f60cf405d791cf76992c8d15539f190", "d2ad88b48a9077d20ff45adeda411aa1cde0a0431f0dbefa9aeae12d72b0ffaf", "104b38173506cc85f62b1184e3f6cd1cf75e86472ae9a5f403724fe37c2b2279", "98275c53575cf77e39d82960082f13fc98175defd6180bc159c58703272b51c4"],
            // targetAddress
            ["cf5ff00933a93c112aabb4db8396f60003363891b461ee93536eb85e7d9809b8", "418f3d6c641758d3fadfd8bcaab60eda112228f8a4fec2b9236bc975f16ef43a", "e24a55c316aaa9fb9a5610f442086f082083c9871e0c608e9cd4a91c23c2a93e", "f3f9566f1a2583f8606ce5c404ca3a8ea42cca04a537c5ce395cc6aa3025370e"]
        ];

        const txEnts = [];

        for (const [i, address] of addresses.entries()) {
            for (const hash of txHashes[i]) {
                const txResp = await wClient.blockchainAPI.getTransaction(hash);

                txResp.vin.forEach(input =>
                    wClient.transactionUTXOService.getUtxoScriptMap().get(address)!.set(`${input.txid}:${input.vout}`, "asdf")
                );

                const txEnt = createTransactionEntity(address, "", txResp.txid);
                txEnt.raw = JSON.stringify({
                    inputs: txResp.vin.map(t => ({
                        prevTxId: t.txid,
                        outputIndex: t.vout,
                        sequenceNumber: 0,
                        script: "",
                        scriptString: "",
                        output: {
                            satoshis: "",
                            script: ""
                        },
                    })),
                });
                txEnt.reachedFinalStatusInTimestamp = toBN(Date.now() - 30 * 60 * 60 * 1000);
                txEnt.chainType = ChainType.testDOGE;
                txEnts.push(txEnt);
            }
        }

        await wClient.rootEm.persistAndFlush(txEnts);

        const numberOfScripts = addresses.map(address => Array.from(wClient.transactionUTXOService.getUtxoScriptMap().get(address)!.keys()).length);
        wClient.transactionUTXOService.setTimestampTracker(Date.now() - 30 * 60 * 60 * 1000);

        await wClient.transactionUTXOService.removeOldUTXOScripts();
        const numberOfScriptsAfterRemoval = addresses.map(address => Array.from(wClient.transactionUTXOService.getUtxoScriptMap().get(address)!.keys()).length);

        for (let i = 0; i < addresses.length; i++) {
            expect(numberOfScripts[i]).to.be.gt(numberOfScriptsAfterRemoval[i]);
        }
    });

    it("Should submit transaction", async () => {
        const txId = await wClient.createPaymentTransaction(fundedAddress, targetAddress, amountToSend);
        expect(txId).greaterThan(0);
        await waitForTxToFinishWithStatus(2, 15 * 60, wClient.rootEm, TransactionStatus.TX_SUCCESS, txId);
    });

    it("Free underlying with unspecified fee should have txFee + txAmount = amount", async () => {
        const txId = await wClient.createPaymentTransaction(fundedAddress, targetAddress, amountToSend, undefined, undefined, undefined, undefined, undefined, true);
        expect(txId).greaterThan(0);
        const txEnt = await waitForTxToFinishWithStatus(2, 15 * 60, wClient.rootEm, TransactionStatus.TX_SUCCESS, txId);
        const tx = await wClient.blockchainAPI.getTransaction(txEnt.transactionHash!);

        let val = 0;
        for (const txOut of tx.vout) {
            if (!txOut.addresses.includes(fundedAddress)) {
                val += Number(txOut.value);
            }
        }

        expect(val + Number(tx.fees)).to.be.eq(txEnt.amount!.toNumber());
    });

    it("Replacement of free underlying transaction should have txFee + txAmount < originalAmount", async () => {
        const txId = await wClient.createPaymentTransaction(fundedAddress, targetAddress, amountToSend, undefined, undefined, undefined, undefined, undefined, true);
        await waitForTxToFinishWithStatus(2, 5 * 60, wClient.rootEm, TransactionStatus.TX_SUBMITTED, txId);
        const blockHeight = await wClient.blockchainAPI.getCurrentBlockHeight();
        await wClient.tryToReplaceByFee(txId, blockHeight);
        const txEnt = await waitForTxToFinishWithStatus(2, 5 * 60, wClient.rootEm, [TransactionStatus.TX_REPLACED, TransactionStatus.TX_REPLACED_PENDING], txId);
        const replacementTxEnt = await waitForTxToFinishWithStatus(2, 5 * 60, wClient.rootEm, TransactionStatus.TX_SUCCESS, txEnt.replaced_by!.id);
        expect(replacementTxEnt.amount?.add(replacementTxEnt.fee!).toNumber()).to.be.lessThanOrEqual(txEnt.amount!.toNumber());
    });

    it.skip('Stress test', async () => {
        const N = 50;
        const minAmount = toBNExp(1, BTC_DOGE_DEC_PLACES);

        const transactionIds = [];
        for (let i = 0; i < N; i++) {
            const wallet = wClient.createWalletFromMnemonic(TEST_DOGE_ACCOUNTS[i].mnemonic);
            await wClient.walletKeys.addKey(wallet.address, wallet.privateKey);
            const balance = await wClient.getAccountBalance(wallet.address);
            const amount = balance.gt(minAmount) ? amountToSend.muln(3.5) : amountToSend.muln(3.5).add(minAmount);

            transactionIds.push(await wClient.createPaymentTransaction(fundedAddress, wallet.address, amount));
        }

        await Promise.all(transactionIds.map(async (t) => await waitForTxToFinishWithStatus(2, 10 * 60, wClient.rootEm, TransactionStatus.TX_SUCCESS, t)));

        const transferTransactionIds = [];
        for (let i = 1; i < N; i++) {
            const id1 = await wClient.createPaymentTransaction(TEST_DOGE_ACCOUNTS[i].address, fundedAddress, amountToSend);
            const id2 = await wClient.createPaymentTransaction(TEST_DOGE_ACCOUNTS[i].address, fundedAddress, amountToSend);
            const id3 = await wClient.createPaymentTransaction(TEST_DOGE_ACCOUNTS[i].address, fundedAddress, amountToSend);
            transferTransactionIds.push(id1, id2, id3)
        }
        await Promise.all(transferTransactionIds.map(async (t) => await waitForTxToFinishWithStatus(2, 10 * 60, wClient.rootEm, TransactionStatus.TX_SUCCESS, t)));
    });

    it("Should submit and replace transaction with 2 wallets", async () => {
        const feeSourceAddress = "nafMJTxsT4r5HjX6Dda8ZBZv7VQFAyjiVh";
        const feeSourcePk = "ckiVwmG9mS8iA5i32TSg6hHVzByyWdBZ8wy5TCrDTFzVPbLPaSjE";
        await wClient.walletKeys.addKey(feeSourceAddress, feeSourcePk);

        const amountToSendSatoshi = toBNExp(10, BTC_DOGE_DEC_PLACES);
        const txId = await wClient.createPaymentTransaction(fundedAddress, feeSourceAddress, amountToSendSatoshi, undefined, undefined, undefined, undefined, undefined, false, feeSourceAddress);
        await waitForTxToFinishWithStatus(2, 15 * 60, wClient.rootEm, TransactionStatus.TX_SUBMITTED, txId);

        const blockHeight = await wClient.blockchainAPI.getCurrentBlockHeight();
        await wClient.tryToReplaceByFee(txId, blockHeight);
        const txEnt = await waitForTxToFinishWithStatus(2, 15 * 60, wClient.rootEm, TransactionStatus.TX_REPLACED_PENDING, txId);

        const { address1Included,  address2Included } = await bothWalletAddresses(wClient, fundedAddress, feeSourceAddress, txEnt.raw!);
        expect(address1Included).to.include(true);
        expect(address2Included).to.include(true);
        const replacementTxEnt = await waitForTxToFinishWithStatus(2, 15 * 60, wClient.rootEm, TransactionStatus.TX_SUBMITTED, txEnt.replaced_by!.id);

        const { address1Included: address1Included1,  address2Included: address2Included1} = await bothWalletAddresses(wClient, fundedAddress, feeSourceAddress, replacementTxEnt.raw!);
        expect(address1Included1).to.include(true);
        expect(address2Included1).to.include(true);

        await updateTransactionEntity(wClient.rootEm, txId, (txEnt) => {
            txEnt.status = TransactionStatus.TX_REPLACED;
        });
        await updateTransactionEntity(wClient.rootEm, txEnt.replaced_by!.id, (txEnt) => {
            txEnt.status = TransactionStatus.TX_SUCCESS;
        });
    });

    it("Should submit free underlying transaction", async () => {
        const amountToSendSatoshi = toBNExp(10, BTC_DOGE_DEC_PLACES);

        const txId = await wClient.createPaymentTransaction(fundedAddress, targetAddress, amountToSendSatoshi, undefined, undefined, undefined, undefined, undefined, true);
        const txEnt = await waitForTxToFinishWithStatus(2, 15 * 60, wClient.rootEm, TransactionStatus.TX_SUBMITTED, txId);

        const transaction = await wClient.blockchainAPI.getTransaction(txEnt.transactionHash!);
        const transactionValue = toBN(transaction.vout[0].value);
        const transactionFee = toBN(transaction.fees);
        expect(transactionValue.add(transactionFee).eq(amountToSendSatoshi)).to.be.true;

        await updateTransactionEntity(wClient.rootEm, txEnt.id, (txEnt) => {
            txEnt.status = TransactionStatus.TX_SUCCESS;
        });
    });

    it("Should submit free underlying transaction with custom fee", async () => {
        const amountToSendSatoshi = toBNExp(10, BTC_DOGE_DEC_PLACES);
        const feeInSatoshi = toBNExp(1, BTC_DOGE_DEC_PLACES);
        const txId = await wClient.createPaymentTransaction(fundedAddress, targetAddress, amountToSendSatoshi, feeInSatoshi, undefined, undefined, undefined, undefined, true);
        const txEnt = await waitForTxToFinishWithStatus(2, 15 * 60, wClient.rootEm, TransactionStatus.TX_SUBMITTED, txId);

        const transaction = await wClient.blockchainAPI.getTransaction(txEnt.transactionHash!);
        expect(toBN(transaction.fees).eq(feeInSatoshi)).to.be.true;

        await updateTransactionEntity(wClient.rootEm, txEnt.id, (txEnt) => {
            txEnt.status = TransactionStatus.TX_SUCCESS;
        });
    });
});
