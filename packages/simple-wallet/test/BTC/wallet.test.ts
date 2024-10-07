import { BTC, SpentHeightEnum, UTXOEntity } from "../../src";
import {
    BitcoinWalletConfig,
    ICreateWalletResponse
} from "../../src/interfaces/IWalletTransaction";
import chaiAsPromised from "chai-as-promised";
import { assert, expect, use } from "chai";

use(chaiAsPromised);
import { toBN, toBNExp } from "../../src/utils/bnutils";
import { getCurrentTimestampInSeconds, sleepMs } from "../../src/utils/utils";
import {TransactionStatus} from "../../src/entity/transaction";
import { initializeTestMikroORM, ORM } from "../test-orm/mikro-orm.config";
import {UnprotectedDBWalletKeys} from "../test-orm/UnprotectedDBWalletKey";
import {
    addConsoleTransportForTests, calculateNewFeeForTx, clearUTXOs, createTransactionEntity,
    loop,
    resetMonitoringOnForceExit,
    setMonitoringStatus,
    waitForTxToFinishWithStatus,
} from "../test-util/util";
import {logger} from "../../src/utils/logger";
import BN from "bn.js";
import { BTC_DOGE_DEC_PLACES, ChainType } from "../../src/utils/constants";
import * as dbutils from "../../src/db/dbutils";
import { DriverException } from "@mikro-orm/core";
import * as utxoUtils from "../../src/chain-clients/utxo/UTXOUtils";
import { ServiceRepository } from "../../src/ServiceRepository";
import { TransactionService } from "../../src/chain-clients/utxo/TransactionService";
import { getCore } from "../../src/chain-clients/utxo/UTXOUtils";
import { BlockchainAPIWrapper } from "../../src/blockchain-apis/UTXOBlockchainAPIWrapper";
// eslint-disable-next-line @typescript-eslint/no-var-requires
const sinon = require("sinon");

// bitcoin test network with fundedAddress "mvvwChA3SRa5X8CuyvdT4sAcYNvN5FxzGE" at
// https://live.blockcypher.com/btc-testnet/address/mvvwChA3SRa5X8CuyvdT4sAcYNvN5FxzGE/

const BTCMccConnectionTestInitial = {
    url: process.env.BTC_URL ?? "",
    inTestnet: true,
    fallbackAPIs: [
        { url: process.env.BTC_URL ?? "", }
    ]
};
let BTCMccConnectionTest: BitcoinWalletConfig;

const fundedMnemonic = "theme damage online elite clown fork gloom alpha scorpion welcome ladder camp rotate cheap gift stone fog oval soda deputy game jealous relax muscle";
const fundedAddress = "tb1qyghw9dla9vl0kutujnajvl6eyj0q2nmnlnx3j0";
const targetMnemonic = "forget fine shop cage build else tree hurry upon sure diary multiply despair skirt hill mango hurdle first screen skirt kind fresh scene prize";
const targetAddress = "tb1q8j7jvsdqxm5e27d48p4382xrq0emrncwfr35k4";

//old funded - still have some funds
//mzM88w7CdxrFyzE8RKZmDmgYQgT5YPdA6S
//cNcsDiLQrYLi8rBERf9XPEQqVPHA7mUXHKWaTrvJVCTaNa68ZDqF
//old target - still have some funds
//a: mwLGdsLWvvGFapcFsx8mwxBUHfsmTecXe2
//pk: cTceSr6rvmAoQAXq617sk4smnzNUvAqkZdnfatfsjbSixBcJqDcY

//funded
// xpub:  vpub5ZQX8V9N9iEqpgfZo42p6eRSA1px1h1cWGvsLjbMbvXE6ymgKCtqq3oZs8dWp2F85pw23QYY8YWqTb1BpCq7G4FQXcSeDv8kFeBiqD7LCvo
// first change address: tb1q9szxd7rnvkkspxp0sl8mha5jk38q9t3rlc2wjx
// first change address private key: cQpQrPr1yrdPLdom5dkxjJgh8bsKp284tPFa2znRs9RTB1VkzQyq
//target
// xpub:  vpub5ZXcEAAqkR4Lg3CBfdYC1fUHkrdRfzxCbRg6tpvERsLB1HpH1KCRcTzQ9TcaLymXpYQmAtyccAcXc1z6UpVNMgcHSuZmmS1YzpvYRHWqd3X
// first change address: tb1q38w40nmt5chk4a60mrh502h7m3l5w6pxpxvr0c
// first change address private key: cTyRVJd6AUUshTBS7DcxfemJh6zeb3iCEJCWYtBsTHizybuHFt6r

const amountToSendSatoshi = toBN(100020);
const feeInSatoshi = toBN(12000);
const maxFeeInSatoshi = toBN(1100);
const note = "10000000000000000000000000000000000000000beefbeaddeafdeaddeedcac";

let wClient: BTC;
let fundedWallet: ICreateWalletResponse;
let testOrm: ORM;

describe("Bitcoin wallet tests", () => {
    let removeConsoleLogging: () => void;

    before(async () => {
        removeConsoleLogging = addConsoleTransportForTests(logger);

        testOrm = await initializeTestMikroORM();
        const unprotectedDBWalletKeys = new UnprotectedDBWalletKeys(testOrm.em);
        BTCMccConnectionTest = {
            ...BTCMccConnectionTestInitial,
            em: testOrm.em,
            walletKeys: unprotectedDBWalletKeys,
            enoughConfirmations: 2
        };
        wClient = await BTC.initialize(BTCMccConnectionTest);
        void wClient.startMonitoringTransactionProgress();
        await sleepMs(2000);
        resetMonitoringOnForceExit(wClient);

        fundedWallet = wClient.createWalletFromMnemonic(fundedMnemonic);
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
        removeConsoleLogging();
    });

    it("Monitoring should be running", async () => {
        const monitoring = await wClient.isMonitoring();
        expect(monitoring).to.be.true;
    });

    it("Should create transaction with custom fee", async () => {
        const txId = await wClient.createPaymentTransaction(fundedAddress, targetAddress, amountToSendSatoshi, feeInSatoshi);
        expect(txId).greaterThan(0);
        const [txEnt, ] = await waitForTxToFinishWithStatus(2, 1 * 60, wClient.rootEm, TransactionStatus.TX_SUBMITTED, txId);
        const info = await wClient.getTransactionInfo(txId);
        expect(info.transactionHash).to.eq(txEnt.transactionHash);
        expect((txEnt.fee!).eq(feeInSatoshi)).to.be.true;
    });

    it("Should not create transaction: fee > maxFee", async () => {
        const txId = await wClient.createPaymentTransaction(fundedAddress, targetAddress, amountToSendSatoshi, feeInSatoshi, note, maxFeeInSatoshi);
        expect(txId).greaterThan(0);
        const [txEnt, ] = await waitForTxToFinishWithStatus(2, 2 * 60, wClient.rootEm, TransactionStatus.TX_FAILED, txId);
        expect((txEnt.fee!).eq(feeInSatoshi)).to.be.true;
        expect((txEnt.maxFee!).eq(maxFeeInSatoshi)).to.be.true;
    });

    it("Should receive fee", async () => {
        const fee = await wClient.getCurrentTransactionFee({
            source: fundedAddress,
            amount: amountToSendSatoshi,
            destination: targetAddress
        });
        expect(fee.gtn(0)).to.be.true;
    });

    it("Should get fee for delete account", async () => {
        fundedWallet = wClient.createWalletFromMnemonic(fundedMnemonic);
        const [transaction,] = await ServiceRepository.get(wClient.chainType, TransactionService).preparePaymentTransaction(0, fundedWallet.address, targetAddress, null, undefined);
        const fee = transaction.getFee();
        expect(fee).to.be.gt(0);
    });

    it("Should get account balance", async () => {
        fundedWallet = wClient.createWalletFromMnemonic(fundedMnemonic);
        const accountBalance = await wClient.getAccountBalance(fundedWallet.address);
        expect(accountBalance.gt(new BN(0))).to.be.true;
    });

    it("Transaction with executeUntilBlock before current block height should fail", async () => {
        const currentBlock = await wClient.blockchainAPI.getCurrentBlockHeight();
        const id = await wClient.createPaymentTransaction(fundedAddress, targetAddress, amountToSendSatoshi, feeInSatoshi, undefined, feeInSatoshi, currentBlock - wClient.executionBlockOffset);
        expect(id).to.be.gt(0);

        const [txEnt] = await waitForTxToFinishWithStatus(2, 40, wClient.rootEm, TransactionStatus.TX_FAILED, id);
        expect(txEnt.status).to.equal(TransactionStatus.TX_FAILED);
    });

    it("Should submit TX_PREPARED that are in DB", async () => {
        fundedWallet = wClient.createWalletFromMnemonic(fundedMnemonic);
        const currentBlock = await wClient.blockchainAPI.getCurrentBlockHeight();
        const executeUntilBlock = currentBlock + wClient.blockOffset;
        const txEnt = await createTransactionEntity(wClient.rootEm, ChainType.testBTC, fundedWallet.address, targetAddress, amountToSendSatoshi, feeInSatoshi, note, undefined, executeUntilBlock);
        const [transaction] = await ServiceRepository.get(wClient.chainType, TransactionService).preparePaymentTransaction(txEnt.id, txEnt.source, txEnt.destination, txEnt.amount ?? null, txEnt.fee, note);
        txEnt.raw = JSON.stringify(transaction);
        txEnt.status = TransactionStatus.TX_PREPARED;
        await wClient.rootEm.flush();
        const [tx] = await waitForTxToFinishWithStatus(2, 15 * 60, wClient.rootEm, TransactionStatus.TX_SUBMITTED, txEnt.id);
        expect(tx.status).to.equal(TransactionStatus.TX_SUBMITTED);
    });

    it("Should handle empty UTXO list in DB", async () => {
        await clearUTXOs(wClient.rootEm);
        const note = "10000000000000000000000000000000000000000beefbeaddeafdeaddeedcab";
        const id = await wClient.createPaymentTransaction(fundedAddress, targetAddress, amountToSendSatoshi, feeInSatoshi, note, undefined);
        expect(id).to.be.gt(0);
        await waitForTxToFinishWithStatus(2, 5 * 60, wClient.rootEm, TransactionStatus.TX_SUBMITTED, id);
    });

    it("Balance should change after transaction", async () => {
        const sourceBalanceStart = await wClient.getAccountBalance(fundedWallet.address);
        const targetBalanceStart = await wClient.getAccountBalance(targetAddress);
        const id = await wClient.createPaymentTransaction(fundedAddress, targetAddress, amountToSendSatoshi);
        expect(id).to.be.gt(0);
        await waitForTxToFinishWithStatus(2, 15 * 60, wClient.rootEm, TransactionStatus.TX_SUBMITTED, id);
        const sourceBalanceEnd = await wClient.getAccountBalance(fundedWallet.address);
        const targetBalanceEnd = await wClient.getAccountBalance(targetAddress);
        expect(sourceBalanceEnd.lt(sourceBalanceStart)).to.be.true;
        expect(targetBalanceEnd.gt(targetBalanceStart)).to.be.true;
    });

    it("Transaction with execute until timestamp too low should fail", async () => {
        const offset = wClient.executionBlockOffset * utxoUtils.getDefaultBlockTimeInSeconds(wClient.chainType)
        const id = await wClient.createPaymentTransaction(fundedAddress, targetAddress, amountToSendSatoshi, feeInSatoshi, undefined, undefined, undefined, toBN(getCurrentTimestampInSeconds() - offset));
        expect(id).to.be.gt(0);
        await waitForTxToFinishWithStatus(2, 30, wClient.rootEm, TransactionStatus.TX_FAILED, id);
    });

    it("Transaction with execute until timestamp too low should fail 2", async () => {
        const currentBlock = await wClient.blockchainAPI.getCurrentBlockHeight();
        const id = await wClient.createPaymentTransaction(fundedAddress, targetAddress, amountToSendSatoshi, feeInSatoshi, undefined, undefined, currentBlock, toBN(20240830203804));
        expect(id).to.be.gt(0);
        await waitForTxToFinishWithStatus(2, 30, wClient.rootEm, TransactionStatus.TX_FAILED, id);
    });

    it("Transaction with a too low fee should be updated with a higher fee", async () => {
        const startFee = toBNExp(0.0000000000001, 0);
        const id = await wClient.createPaymentTransaction(fundedAddress, targetAddress, amountToSendSatoshi, startFee, note, undefined);
        expect(id).to.be.gt(0);
        const [txEnt] = await waitForTxToFinishWithStatus(2, 15 * 60, wClient.rootEm, TransactionStatus.TX_SUBMITTED, id);
        expect(txEnt.fee?.toNumber()).to.be.gt(startFee.toNumber());
    });

    it.skip("Already spent UTXOs with wrong status should get a new status - consistency checker", async () => {
        const id = await wClient.createPaymentTransaction(fundedAddress, targetAddress, amountToSendSatoshi, undefined, note, undefined);
        expect(id).to.be.gt(0);
        await waitForTxToFinishWithStatus(2, 15 * 60, wClient.rootEm, TransactionStatus.TX_SUCCESS, id);
        let utxoEnt;
        do {
            utxoEnt = await wClient.rootEm.findOne(UTXOEntity, { spentHeight: SpentHeightEnum.SPENT });
            await sleepMs(500);
        } while (!utxoEnt);
        utxoEnt.spentHeight = SpentHeightEnum.UNSPENT;
        await wClient.rootEm.persistAndFlush(utxoEnt);

        const id2 = await wClient.createPaymentTransaction(fundedAddress, targetAddress, amountToSendSatoshi, undefined, note, undefined);
        expect(id2).to.be.gt(0);
        utxoEnt = await wClient.rootEm.findOne(UTXOEntity, { spentHeight: SpentHeightEnum.SPENT });
        assert(utxoEnt !== null);
        assert(utxoEnt.spentHeight === SpentHeightEnum.SPENT);
    });

    it("Test blockchain API connection down", async () => {
        const id = await wClient.createPaymentTransaction(fundedAddress, targetAddress, amountToSendSatoshi, undefined, note, undefined);
        expect(id).to.be.gt(0);

        const interceptorId = wClient.blockchainAPI.client.interceptors.request.use(
            config => Promise.reject(`Down`),
        );
        await sleepMs(5000);
        console.info("API connection up");
        wClient.blockchainAPI.client.interceptors.request.eject(interceptorId);
        await waitForTxToFinishWithStatus(2, 15 * 60, wClient.rootEm, TransactionStatus.TX_SUBMITTED, id);
    });

    it("If getCurrentFeeRate is down the fee should be the default one", async () => {
        fundedWallet = wClient.createWalletFromMnemonic(fundedMnemonic);
        sinon.stub(wClient.feeService, "getLatestFeeStats").rejects(new Error("No fee stats"));
        sinon.stub(wClient.blockchainAPI, "getCurrentFeeRate").rejects(new Error("No fee"));

        const id = await wClient.createPaymentTransaction(fundedAddress, targetAddress, amountToSendSatoshi, undefined, note, undefined);
        expect(id).to.be.gt(0);
        await waitForTxToFinishWithStatus(0.1, 5 * 60, wClient.rootEm, TransactionStatus.TX_SUBMITTED, id);

        const [dbFee, calculatedFee] = await calculateNewFeeForTx(id, utxoUtils.getDefaultFeePerKB(ChainType.testBTC), getCore(wClient.chainType), wClient.rootEm);
        expect(dbFee?.toNumber()).to.be.equal(calculatedFee);
        sinon.restore();
    });

    it("If fee service is down the getCurrentFeeRate should be used", async () => {
        sinon.stub(wClient.feeService, "getLatestFeeStats").rejects(new Error("No fee stats"));

        const fee = "0.005";
        const feeRateInSatoshi = toBNExp(fee, BTC_DOGE_DEC_PLACES).muln(wClient.feeIncrease);

        sinon.stub(ServiceRepository.get(wClient.chainType, BlockchainAPIWrapper), "getCurrentFeeRate").resolves(fee);

        const id = await wClient.createPaymentTransaction(fundedAddress, targetAddress, amountToSendSatoshi, undefined, note, undefined);
        expect(id).to.be.gt(0);

        await waitForTxToFinishWithStatus(2, 5 * 60, wClient.rootEm, TransactionStatus.TX_SUBMITTED, id);
        const [dbFee, calculatedFee] = await calculateNewFeeForTx(id, feeRateInSatoshi, getCore(wClient.chainType), wClient.rootEm);
        expect(dbFee?.toNumber()).to.be.equal(calculatedFee);

        sinon.restore();
    });

    it("If monitoring restarts wallet should run normally", async () => {
        const N = 2;
        await sleepMs(2000);
        await wClient.stopMonitoring();
        const isMonitoring = await wClient.isMonitoring();
        expect(isMonitoring).to.be.false;

        const initialTxIds = [];
        for (let i = 0; i < N; i++) {
            initialTxIds.push(await wClient.createPaymentTransaction(fundedAddress, targetAddress, amountToSendSatoshi.addn(i)));
        }
        await sleepMs(2000);
        void wClient.startMonitoringTransactionProgress();
        for (let i = 0; i < N; i++) {
            await waitForTxToFinishWithStatus(2, 5 * 60, wClient.rootEm, TransactionStatus.TX_SUBMITTED, initialTxIds[i]);
        }
    });

    it("'updateTransactionEntity' is down", async () => {
        const id = await wClient.createPaymentTransaction(fundedAddress, targetAddress, amountToSendSatoshi);

        await waitForTxToFinishWithStatus(0.01, 5 * 60, wClient.rootEm, TransactionStatus.TX_PREPARED, id);
        sinon.stub(dbutils, "updateTransactionEntity").throws(new DriverException(new Error("DB down")));

        await sleepMs(10000);
        sinon.restore();

        await waitForTxToFinishWithStatus(0.001, 5 * 60, wClient.rootEm, TransactionStatus.TX_SUBMITTED, id);
    });

    it("Should replace transaction by fee", async () => {
        const id = await wClient.createPaymentTransaction(fundedAddress, targetAddress, amountToSendSatoshi);
        const currentBlock = await ServiceRepository.get(wClient.chainType, BlockchainAPIWrapper).getCurrentBlockHeight()
        await wClient.tryToReplaceByFee(id, currentBlock)
        expect(id).to.be.gt(0);
        await waitForTxToFinishWithStatus(0.005, 50, wClient.rootEm, [TransactionStatus.TX_PREPARED, TransactionStatus.TX_REPLACED, TransactionStatus.TX_SUBMITTED], id);
    });

    it.skip("Should send transaction", async () => {
        const txId = await wClient.createPaymentTransaction(fundedAddress, targetAddress, amountToSendSatoshi);
        expect(txId).greaterThan(0);
        await waitForTxToFinishWithStatus(2, 15 * 60, wClient.rootEm, TransactionStatus.TX_SUCCESS, txId);
        const info = await wClient.getTransactionInfo(txId);
        expect(info.status).to.eq(TransactionStatus.TX_SUCCESS);
    });

    it("Should submit and replace transaction", async () => {
        const txId = await wClient.createPaymentTransaction(fundedAddress, targetAddress, amountToSendSatoshi);
        expect(txId).greaterThan(0);
        await waitForTxToFinishWithStatus(2, 15 * 60, wClient.rootEm, TransactionStatus.TX_SUBMITTED, txId);
        const blockHeight = await ServiceRepository.get(wClient.chainType, BlockchainAPIWrapper).getCurrentBlockHeight();
        await wClient.tryToReplaceByFee(txId, blockHeight);
        const txEnt = await dbutils.fetchTransactionEntityById(wClient.rootEm, txId);
        expect(txEnt.status).to.eq(TransactionStatus.TX_REPLACED);
    });

    it("Should check monitoring already running and restart it", async () => {
        expect(await wClient.isMonitoring()).to.be.true;
        await wClient.startMonitoringTransactionProgress();
        expect(await wClient.isMonitoring()).to.be.true;
        await wClient.stopMonitoring();
        expect(await wClient.isMonitoring()).to.be.false;
        void wClient.startMonitoringTransactionProgress();
        await sleepMs(2000);
        expect(await wClient.isMonitoring()).to.be.true;
     });

    it.skip("Monitoring into infinity", async () => {
        while (true) {
            await sleepMs(2000);
        }
    });

    it.skip("Should prepare and execute transaction", async () => {// Needed only to transfer funds
        const source = "";
        const target = "";
        const amountToSendInSats = toBNExp(1, BTC_DOGE_DEC_PLACES);
        const noteToSend = "Transfer";
        const id = await wClient.createPaymentTransaction(source, target, amountToSendInSats, undefined, noteToSend);
        expect(id).to.be.gt(0);
        await waitForTxToFinishWithStatus(2, 15 * 60, wClient.rootEm, TransactionStatus.TX_SUCCESS, id);
    });
});