import {BTC, SpentHeightEnum, TransactionStatus, UTXOEntity} from "../../src";
import {BitcoinWalletConfig, ICreateWalletResponse, ITransactionMonitor} from "../../src/interfaces/IWalletTransaction";
import chaiAsPromised from "chai-as-promised";
import {assert, expect, use} from "chai";
import {toBN, toBNExp} from "../../src/utils/bnutils";
import {getCurrentTimestampInSeconds, sleepMs} from "../../src/utils/utils";
import config, {initializeTestMikroORM, initializeTestMikroORMWithConfig, ORM} from "../test-orm/mikro-orm.config";
import {UnprotectedDBWalletKeys} from "../test-orm/UnprotectedDBWalletKey";
import {
    addConsoleTransportForTests,
    calculateNewFeeForTx,
    loop,
    resetMonitoringOnForceExit,
    waitForTxToFinishWithStatus,
} from "../test-util/common_utils";
import {logger} from "../../src/utils/logger";
import BN from "bn.js";
import {BTC_DOGE_DEC_PLACES, BTC_DUST_AMOUNT, ChainType} from "../../src/utils/constants";
import * as dbutils from "../../src/db/dbutils";
import {
    correctUTXOInconsistenciesAndFillFromMempool,
    fetchTransactionEntityById,
    fetchUTXOsByTxId,
    getTransactionInfoById,
    updateTransactionEntity
} from "../../src/db/dbutils";
import {DriverException} from "@mikro-orm/core";
import * as utxoUtils from "../../src/chain-clients/utxo/UTXOUtils";
import {getCore} from "../../src/chain-clients/utxo/UTXOUtils";
import {
    createAndPersistTransactionEntity,
    createAndPersistUTXOEntity,
    createTransactionEntity,
    createTransactionOutputEntity,
    setMonitoringStatus,
    setWalletStatusInDB,
} from "../test-util/entity_utils";
import sinon from "sinon";
import {FeeStatus} from "../../src/chain-clients/utxo/TransactionFeeService";
import {UTXORawTransactionInput} from "../../src/interfaces/IBlockchainAPI";
import {TransactionMonitor} from "../../src/chain-clients/monitoring/TransactionMonitor";

use(chaiAsPromised);
// bitcoin test network with fundedAddress "mvvwChA3SRa5X8CuyvdT4sAcYNvN5FxzGE" at
// https://live.blockcypher.com/btc-testnet/address/mvvwChA3SRa5X8CuyvdT4sAcYNvN5FxzGE/

const BTCMccConnectionTestInitial = {
    urls: [process.env.BTC_URL ?? ""],
    inTestnet: true,
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
let monitor: ITransactionMonitor;

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
            enoughConfirmations: 2,
        };
        wClient = BTC.initialize(BTCMccConnectionTest);
        monitor = await wClient.createMonitor();
        await monitor.startMonitoring();
        await sleepMs(2000);
        resetMonitoringOnForceExit(monitor);

        fundedWallet = wClient.createWalletFromMnemonic(fundedMnemonic);
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

    beforeEach(async () => {
        sinon.restore();
    });

    it("Monitoring should be running", async () => {
        const monitoring = monitor.isMonitoring();
        expect(monitoring).to.be.true;
    });

    it("Should create transaction with custom fee", async () => {
        const feeToUse = feeInSatoshi.muln(10);
        const txId = await wClient.createPaymentTransaction(fundedAddress, targetAddress, amountToSendSatoshi, feeToUse);
        expect(txId).greaterThan(0);
        const [txEnt] = await waitForTxToFinishWithStatus(2, 1 * 120, wClient.rootEm, TransactionStatus.TX_SUBMITTED, txId);
        const info = await wClient.getTransactionInfo(txId);
        expect(info.transactionHash).to.eq(txEnt.transactionHash);
        expect((txEnt.fee!).eq(feeToUse)).to.be.true;
    });

    it("Should not create transaction: fee > maxFee", async () => {
        const txId = await wClient.createPaymentTransaction(fundedAddress, targetAddress, amountToSendSatoshi, feeInSatoshi, note, maxFeeInSatoshi);
        expect(txId).greaterThan(0);
        const [txEnt] = await waitForTxToFinishWithStatus(2, 2 * 60, wClient.rootEm, TransactionStatus.TX_FAILED, txId);
        expect((txEnt.fee!).eq(feeInSatoshi)).to.be.true;
        expect((txEnt.maxFee!).eq(maxFeeInSatoshi)).to.be.true;
    });

    it("Should receive fee", async () => {
        const fee = await wClient.getCurrentTransactionFee({
            source: fundedAddress,
            amount: amountToSendSatoshi,
            destination: targetAddress,
        });
        expect(fee.gtn(0)).to.be.true;
    });

    it("Should get fee for delete account", async () => {
        const utxosFromMempool = await wClient.blockchainAPI.getUTXOsFromMempool(fundedAddress);
        await correctUTXOInconsistenciesAndFillFromMempool(wClient.rootEm, fundedWallet.address, utxosFromMempool);
        const [transaction] = await wClient.transactionService.preparePaymentTransaction(0, fundedWallet.address, targetAddress, null, undefined);
        const fee = transaction.getFee();
        expect(fee).to.be.gt(0);
    });

    it("Should get account balance", async () => {
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
        const txEnt = await createAndPersistTransactionEntity(wClient.rootEm, ChainType.testBTC, fundedWallet.address, targetAddress, amountToSendSatoshi);
        const [transaction] = await wClient.transactionService.preparePaymentTransaction(txEnt.id, txEnt.source, txEnt.destination, txEnt.amount ?? null);
        txEnt.raw = JSON.stringify(transaction);
        txEnt.status = TransactionStatus.TX_PREPARED;
        await wClient.rootEm.flush();
        const [tx] = await waitForTxToFinishWithStatus(2, 15 * 60, wClient.rootEm, TransactionStatus.TX_SUBMITTED, txEnt.id);
        expect(tx.status).to.equal(TransactionStatus.TX_SUBMITTED);
    });

    it("Balance should change after transaction", async () => {
        const sourceBalanceStart = await wClient.getAccountBalance(fundedWallet.address);
        const targetBalanceStart = await wClient.getAccountBalance(targetAddress);
        const id = await wClient.createPaymentTransaction(fundedAddress, targetAddress, amountToSendSatoshi);
        expect(id).to.be.gt(0);
        await waitForTxToFinishWithStatus(2, 15 * 60, wClient.rootEm, TransactionStatus.TX_SUCCESS, id);
        const sourceBalanceEnd = await wClient.getAccountBalance(fundedWallet.address);
        const targetBalanceEnd = await wClient.getAccountBalance(targetAddress);
        expect(sourceBalanceEnd.lt(sourceBalanceStart)).to.be.true;
        expect(targetBalanceEnd.gt(targetBalanceStart)).to.be.true;
    });

    it("Transaction with execute until timestamp too low should fail", async () => {
        const offset = wClient.executionBlockOffset * utxoUtils.getDefaultBlockTimeInSeconds(wClient.chainType);
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

        const interceptorId = wClient.blockchainAPI.clients[0].interceptors.request.use(
            config => Promise.reject(`Down`),
        );
        await sleepMs(5000);
        console.info("API connection up");
        wClient.blockchainAPI.clients[0].interceptors.request.eject(interceptorId);
        await waitForTxToFinishWithStatus(2, 15 * 60, wClient.rootEm, TransactionStatus.TX_SUBMITTED, id);
    });

    it("If getCurrentFeeRate is down the fee should be the default one", async () => {
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

        const fee = 0.0005;
        const feeRateInSatoshi = toBNExp(fee, BTC_DOGE_DEC_PLACES).muln(wClient.feeIncrease);

        sinon.stub(wClient.blockchainAPI, "getCurrentFeeRate").resolves(toBNExp(fee, BTC_DOGE_DEC_PLACES).toNumber());

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
        await monitor.stopMonitoring();
        const isMonitoring = await monitor.isMonitoring();
        expect(isMonitoring).to.be.false;

        const initialTxIds = [];
        for (let i = 0; i < N; i++) {
            initialTxIds.push(await wClient.createPaymentTransaction(fundedAddress, targetAddress, amountToSendSatoshi.addn(i)));
        }
        await sleepMs(2000);
        monitor = await wClient.createMonitor();
        await monitor.startMonitoring();
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

    it("Should submit and replace transaction", async () => {
        const txId = await wClient.createPaymentTransaction(fundedAddress, targetAddress, amountToSendSatoshi);
        expect(txId).greaterThan(0);
        await waitForTxToFinishWithStatus(2, 15 * 60, wClient.rootEm, TransactionStatus.TX_SUBMITTED, txId);
        const blockHeight = await wClient.blockchainAPI.getCurrentBlockHeight();
        await wClient.tryToReplaceByFee(txId, blockHeight);
        await waitForTxToFinishWithStatus(2, 15 * 60, wClient.rootEm, [TransactionStatus.TX_REPLACED, TransactionStatus.TX_REPLACED_PENDING], txId);
        const txEnt = await dbutils.fetchTransactionEntityById(wClient.rootEm, txId);
        await waitForTxToFinishWithStatus(2, 15 * 60, wClient.rootEm, TransactionStatus.TX_SUBMITTED, txEnt.replaced_by!.id);
    });

    it("Should check monitoring already running and restart it", async () => {
        expect(monitor.isMonitoring()).to.be.true;
        await monitor.stopMonitoring();
        await (monitor as TransactionMonitor).startMonitoring();
        expect(monitor.isMonitoring()).to.be.true;
        await monitor.stopMonitoring();
        expect(monitor.isMonitoring()).to.be.false;
        await (monitor as TransactionMonitor).startMonitoring();
        await sleepMs(2000);
        expect(monitor.isMonitoring()).to.be.true;
    });

    it("Account that is being deleted should not accept new transactions", async () => {
        const wallet = wClient.createWallet();
        await wClient.walletKeys.addKey(wallet.address, wallet.privateKey);
        await setWalletStatusInDB(wClient.rootEm, wallet.address, true);

        await expect(wClient.createPaymentTransaction(wallet.address, targetAddress, amountToSendSatoshi))
            .to.eventually.be.rejectedWith(`Cannot receive requests. ${wallet.address} is deleting`);

        await expect(wClient.createDeleteAccountTransaction(wallet.address, targetAddress))
            .to.eventually.be.rejectedWith(`Cannot receive requests. ${wallet.address} is deleting`);

        await setWalletStatusInDB(wClient.rootEm, wallet.address, false);
    });

    it("Account without private key shouldn't be able to create transaction", async () => {
        const wallet = wClient.createWallet();
        await expect(wClient.createPaymentTransaction(wallet.address, targetAddress, amountToSendSatoshi)).to.eventually.be.rejectedWith(`Cannot prepare transaction ${wallet.address}. Missing private key.`);
        await expect(wClient.createDeleteAccountTransaction(wallet.address, targetAddress)).to.eventually.be.rejectedWith(`Cannot prepare transaction ${wallet.address}. Missing private key.`);
    });

    it("If private key for fee wallet is missing transaction shouldn't be created", async () => {
        const wallet = wClient.createWallet();
        await expect(
            wClient.createPaymentTransaction(fundedAddress, targetAddress, amountToSendSatoshi, undefined, undefined, undefined, undefined, undefined, wallet.address),
        ).to.eventually.be.rejectedWith(`Cannot prepare transaction ${fundedAddress}. Missing private key for fee wallet.`);
    });

    it("Paying fees from another wallet", async () => {
        //old target - still have some funds
        //a: mwLGdsLWvvGFapcFsx8mwxBUHfsmTecXe2
        //pk: cTceSr6rvmAoQAXq617sk4smnzNUvAqkZdnfatfsjbSixBcJqDcY

        const feeSourceAddress = "mwLGdsLWvvGFapcFsx8mwxBUHfsmTecXe2";
        const feeSourcePk = "cTceSr6rvmAoQAXq617sk4smnzNUvAqkZdnfatfsjbSixBcJqDcY";
        await wClient.walletKeys.addKey(feeSourceAddress, feeSourcePk);

        // Refill the fee wallet, so that it doesn't get empty
        const fundTxId = await wClient.createPaymentTransaction(fundedAddress, feeSourceAddress, amountToSendSatoshi, feeInSatoshi);
        await waitForTxToFinishWithStatus(2, 5 * 60, wClient.rootEm, TransactionStatus.TX_SUBMITTED, fundTxId);

        const id = await wClient.createPaymentTransaction(fundedAddress, targetAddress, amountToSendSatoshi, feeInSatoshi, undefined, undefined, undefined, undefined, feeSourceAddress);
        await waitForTxToFinishWithStatus(2, 5 * 60, wClient.rootEm, TransactionStatus.TX_SUBMITTED, id);

        const txEnt = await fetchTransactionEntityById(wClient.rootEm, id);
        expect(txEnt.utxos.getItems().map(t => t.source)).to.include.members([fundedAddress, feeSourceAddress]);
    });

    it("Should submit and replace transaction with 2 wallets", async () => {
        //old target - still have some funds
        //a: mwLGdsLWvvGFapcFsx8mwxBUHfsmTecXe2
        //pk: cTceSr6rvmAoQAXq617sk4smnzNUvAqkZdnfatfsjbSixBcJqDcY

        const feeSourceAddress = "mwLGdsLWvvGFapcFsx8mwxBUHfsmTecXe2";
        const feeSourcePk = "cTceSr6rvmAoQAXq617sk4smnzNUvAqkZdnfatfsjbSixBcJqDcY";
        await wClient.walletKeys.addKey(feeSourceAddress, feeSourcePk);

        // Refill the fee wallet, so that it doesn't get empty
        const fundTxId = await wClient.createPaymentTransaction(fundedAddress, feeSourceAddress, amountToSendSatoshi, feeInSatoshi);
        await waitForTxToFinishWithStatus(2, 5 * 60, wClient.rootEm, TransactionStatus.TX_SUBMITTED, fundTxId);

        const txId = await wClient.createPaymentTransaction(fundedAddress, targetAddress, amountToSendSatoshi, undefined, note, undefined, undefined, undefined, feeSourceAddress);
        await waitForTxToFinishWithStatus(2, 15 * 60, wClient.rootEm, TransactionStatus.TX_SUBMITTED, txId);

        const blockHeight = await wClient.blockchainAPI.getCurrentBlockHeight();
        await wClient.tryToReplaceByFee(txId, blockHeight);
        await waitForTxToFinishWithStatus(2, 15 * 60, wClient.rootEm, TransactionStatus.TX_REPLACED, txId);

        const txEnt = await dbutils.fetchTransactionEntityById(wClient.rootEm, txId);
        expect(txEnt.utxos.getItems().map(t => t.source)).to.include.members([fundedAddress, feeSourceAddress]);
        await waitForTxToFinishWithStatus(2, 15 * 60, wClient.rootEm, TransactionStatus.TX_SUBMITTED, txEnt.replaced_by!.id);

        const replacementTxEnt = await fetchTransactionEntityById(wClient.rootEm, txEnt.replaced_by!.id);
        expect(replacementTxEnt.utxos.getItems().map(t => t.source)).to.include.members([fundedAddress, feeSourceAddress]);
    });

    it("If transaction doesn't exist / has a wrong structure, it's list of UTXOs should be empty", async () => {
        expect((await fetchUTXOsByTxId(wClient.rootEm, -1)).length).to.be.eq(0);
        const txEnt = createTransactionEntity(fundedAddress, targetAddress, "hash");
        txEnt.raw = "asdf";
        await wClient.rootEm.persistAndFlush(txEnt);

        expect((await fetchUTXOsByTxId(wClient.rootEm, txEnt.id)).length).to.be.eq(0);
    });

    it("Should not create transaction: amount = dust amount", async () => {
        const utxosFromMempool = await wClient.blockchainAPI.getUTXOsFromMempool(fundedAddress);
        await correctUTXOInconsistenciesAndFillFromMempool(wClient.rootEm, fundedAddress, utxosFromMempool);

        await expect(wClient.transactionService.preparePaymentTransaction(0, fundedAddress, targetAddress, BTC_DUST_AMOUNT)).to
            .eventually.be.rejectedWith(`Will not prepare transaction 0, for ${fundedAddress}. Amount ${BTC_DUST_AMOUNT.toString()} is less than dust ${BTC_DUST_AMOUNT.toString()}`);
    });

    it("If network is down, the monitoring should continue to operate", async () => {
        const id = await wClient.createPaymentTransaction(fundedAddress, targetAddress, amountToSendSatoshi);
        await monitor.stopMonitoring();

        const stub = sinon.stub(utxoUtils, "checkUTXONetworkStatus");
        stub.onCall(0).resolves(false);
        stub.onCall(1).resolves(false);
        stub.resolves(!!(await wClient.blockchainAPI.getCurrentBlockHeight()));

        await (monitor as TransactionMonitor).startMonitoring();
        await waitForTxToFinishWithStatus(2, 5 * 60, wClient.rootEm, TransactionStatus.TX_SUBMITTED, id);
    });

    it.skip("If DB is down (therefore ping too) the monitoring should eventually stop", async () => {
        const id = await wClient.createPaymentTransaction(fundedAddress, targetAddress, amountToSendSatoshi);
        sinon.stub(dbutils, "updateMonitoringState").throws(new Error("Ping down"));

        await loop(500, 60 * 1000, null, async () => {
            return !(monitor.isMonitoring());
        });

        sinon.restore();
    });

    it.skip("DB down after creating transaction", async () => {
        fundedWallet = wClient.createWalletFromMnemonic(fundedMnemonic);
        const id = await wClient.createPaymentTransaction(fundedWallet.address, targetAddress, amountToSendSatoshi);
        const txInfo = await getTransactionInfoById(wClient.rootEm, id);
        expect(txInfo.status).to.be.equal(TransactionStatus.TX_CREATED);

        await waitForTxToFinishWithStatus(0.001, 5 * 60, wClient.rootEm, TransactionStatus.TX_PREPARED, id);
        await testOrm.close();
        await sleepMs(5000);
        await testOrm.connect();
        // await waitForTxToFinishWithStatus(1, 15 * 60, wClient.rootEm, TransactionStatus.TX_SUBMITTED, id);
        const id2 = await wClient.createPaymentTransaction(fundedWallet.address, targetAddress, amountToSendSatoshi);
        await waitForTxToFinishWithStatus(1, 15 * 60, wClient.rootEm, TransactionStatus.TX_SUBMITTED, id2);
    });

    it.skip("If transaction uses already spent UTXOs they should be removed and it's status should be set to TX_CREATED", async () => {
        await monitor.stopMonitoring();

        const tx1 = createTransactionEntity(targetAddress, fundedAddress, "ef99f95e95b18adfc44aae79722946e583677eb631a89a1b62fe0e275801a10c");
        const tx2 = createTransactionEntity(targetAddress, fundedAddress, "2a6a5d5607492467e357140426f48e75e5ab3fa5fb625b6f201cce284f0dc55e");
        const utxos = await Promise.all([
            await createAndPersistUTXOEntity(wClient.rootEm, fundedAddress, "ef99f95e95b18adfc44aae79722946e583677eb631a89a1b62fe0e275801a10c", 0, SpentHeightEnum.SPENT),
            await createAndPersistUTXOEntity(wClient.rootEm, fundedAddress, "2a6a5d5607492467e357140426f48e75e5ab3fa5fb625b6f201cce284f0dc55e", 0, SpentHeightEnum.SPENT),
        ]);

        // So that we don't need to create an actual raw transaction ...
        sinon.stub(dbutils, "fetchUTXOsByTxId").resolves(utxos);

        const initialTxEnt = createTransactionEntity(fundedAddress, targetAddress, "hash", [tx1, tx2], TransactionStatus.TX_PREPARED);
        initialTxEnt.outputs.set([createTransactionOutputEntity("asdf", 0)]);

        await wClient.rootEm.persistAndFlush([initialTxEnt, tx1, tx2]);

        const txEnt = await fetchTransactionEntityById(wClient.rootEm, initialTxEnt.id);
        expect(txEnt.status).to.be.eq(TransactionStatus.TX_PREPARED);
        expect(txEnt.utxos.getItems()).to.include.members(utxos);
        expect(txEnt.inputs.getItems().length).to.eq(utxos.length);
        expect(txEnt.outputs.getItems().length).to.eq(1);

        const usesAlreadySpent = await wClient.transactionUTXOService.checkIfTxUsesAlreadySpentUTXOs(initialTxEnt.id);
        expect(usesAlreadySpent).to.be.eq(true);
        expect(txEnt.utxos.getItems()).to.be.empty;
        expect(txEnt.inputs.getItems().length).to.eq(0);
        expect(txEnt.outputs.getItems().length).to.eq(0);
        expect(txEnt.transactionHash).to.be.eq("");

    });

    it("Handling of legacy UTXOs", async () => {
        //old target - still have some funds
        //a: mwLGdsLWvvGFapcFsx8mwxBUHfsmTecXe2
        //pk: cTceSr6rvmAoQAXq617sk4smnzNUvAqkZdnfatfsjbSixBcJqDcY

        const walletAddress = "mwLGdsLWvvGFapcFsx8mwxBUHfsmTecXe2";
        const walletPk = "cTceSr6rvmAoQAXq617sk4smnzNUvAqkZdnfatfsjbSixBcJqDcY";
        await wClient.walletKeys.addKey(walletAddress, walletPk);

        sinon.stub(wClient.transactionFeeService, "getCurrentFeeStatus").resolves(FeeStatus.LOW);
        sinon.stub(wClient.transactionFeeService, "getFeePerKB").resolves(new BN(1000));

        const utxosFromMempool = [
            {
                mintTxid: "7501baa23ca6c474982a0be74dabde9571dde76f51ac915901bf1143064925c0",
                mintIndex: 0,
                value: toBN("70000"),
                script: "",
                confirmed: true,
            },
            {
                mintTxid: "96524f2c23b0324f2f23314187d2f61a9cfb0245c4299cb34125228493dc219c",
                mintIndex: 0,
                value: toBN("70000"),
                script: "",
                confirmed: true,
            },
        ];

        await correctUTXOInconsistenciesAndFillFromMempool(wClient.rootEm, walletAddress, utxosFromMempool);
        const [tr] = await wClient.transactionService.preparePaymentTransaction(0, walletAddress, fundedAddress, toBN(100020));
        expect(tr.inputs.length).to.be.eq(2);

    });

    it("Handling of a combination of legacy and segwit UTXOs", async () => {
        //old target - still have some funds
        //a: mwLGdsLWvvGFapcFsx8mwxBUHfsmTecXe2
        //pk: cTceSr6rvmAoQAXq617sk4smnzNUvAqkZdnfatfsjbSixBcJqDcY

        const walletAddress = "mwLGdsLWvvGFapcFsx8mwxBUHfsmTecXe2";
        const walletPk = "cTceSr6rvmAoQAXq617sk4smnzNUvAqkZdnfatfsjbSixBcJqDcY";
        await wClient.walletKeys.addKey(walletAddress, walletPk);

        sinon.stub(wClient.transactionFeeService, "getCurrentFeeStatus").resolves(FeeStatus.LOW);
        sinon.stub(wClient.transactionFeeService, "getFeePerKB").resolves(new BN(1000));

        const utxosFromMempool = [
            {
                mintTxid: "4b4f50ff7ae8e363c50d9341bcccf9fbd77bf9fc37c0c7468ebdab6d2e6348a4",
                mintIndex: 0,
                value: toBN(100020),
                script: "",
                confirmed: true,
            },
            {
                mintTxid: "5fe1c8760bf86452758fc8206674f9ec9eb9b0779839f31891cf050f41565c67",
                mintIndex: 0,
                value: toBN(100020),
                script: "",
                confirmed: true,
            },
            {
                mintTxid: "96524f2c23b0324f2f23314187d2f61a9cfb0245c4299cb34125228493dc219c",
                mintIndex: 0,
                value: toBN(70000),
                script: "",
                confirmed: true,
            },
        ];
        await correctUTXOInconsistenciesAndFillFromMempool(wClient.rootEm, walletAddress, utxosFromMempool);
        const [tr] = await wClient.transactionService.preparePaymentTransaction(0, walletAddress, fundedAddress, toBN(100020).muln(2));
        expect(tr.inputs.length).to.be.eq(3);
    });

    it("Should find transaction hash based only on inputs", async () => {
        const inputs: UTXORawTransactionInput[] = [{
            prevTxId: "b4dde1f2b716078a4e0fb079e6190e48de37048fd96027e6f85a83f25f3bc825",
            outputIndex: 1,
            sequenceNumber: 123123,
            script: "",
            scriptString: "",
            output: {
                script: "123",
                satoshis: 123,
            },
        }];

        const hash = await wClient.blockchainAPI.findTransactionHashWithInputs("tb1qyghw9dla9vl0kutujnajvl6eyj0q2nmnlnx3j0", inputs, 3194814);
        expect(hash === "8a09126a5953d182bf1203de91bac5e89cae279bc1eeb7e302e4fd2093e16043").to.be.true;
    });

    it("Should find transaction hash based only on inputs even if block height is not completely accurate", async () => {
        const inputs: UTXORawTransactionInput[] = [{
            prevTxId: "b4dde1f2b716078a4e0fb079e6190e48de37048fd96027e6f85a83f25f3bc825",
            outputIndex: 1,
            sequenceNumber: 123123,
            script: "",
            scriptString: "",
            output: {
                script: "123",
                satoshis: 123,
            },
        }];

        const hash = await wClient.blockchainAPI.findTransactionHashWithInputs("tb1qyghw9dla9vl0kutujnajvl6eyj0q2nmnlnx3j0", inputs, 3194810);
        expect(hash === "8a09126a5953d182bf1203de91bac5e89cae279bc1eeb7e302e4fd2093e16043").to.be.true;
    });

    // it.skip("Delete account with multiple transactions", async () => {
    //     const maximumNumberOfUTXOs = 3;
    //     const numberOfDeleteTxs = 3;

    //     const mnemonic = "express exhibit hidden disease order baby photo pair fantasy age chaos velvet very nerve display soldier kite profit actress emerge soup hover clay canyon";
    //     const wallet = wClient.createWalletFromMnemonic(mnemonic);
    //     await wClient.walletKeys.addKey(wallet.address, wallet.privateKey);

    //     wClient.transactionService = new TransactionService(wClient, wClient.chainType, maximumNumberOfUTXOs);

    //     const ids: number[] = [];
    //     for (let i = 0; i < maximumNumberOfUTXOs * numberOfDeleteTxs; i++) {
    //         ids.push(await wClient.createPaymentTransaction(fundedAddress, wallet.address, amountToSendSatoshi));
    //     }

    //     await Promise.all(ids.map(async (id) =>
    //         await waitForTxToFinishWithStatus(2, 5 * 60, wClient.rootEm, TransactionStatus.TX_SUCCESS, id)
    //     ));

    //     const blockHeight = await wClient.blockchainAPI.getCurrentBlockHeight();
    //     const id = await wClient.createDeleteAccountTransaction(wallet.address, fundedAddress, undefined, undefined, undefined, blockHeight + 100);
    //     await loop(2000, 30 * 60_000, null, async () => {
    //         const balance = await getAccountBalance(wClient.blockchainAPI, wallet.address);
    //         return balance < amountToSendSatoshi;
    //     });

    //     const deleteTxs = await wClient.rootEm.find(TransactionEntity, {
    //         id: { $gte: id },
    //         amount: null
    //     });

    //     expect(deleteTxs.length).to.be.gte(numberOfDeleteTxs);
    // });

    /*
    UTILS
     */

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

    it.skip("Send funds back to funded address", async () => {
        const targetWallet = wClient.createWalletFromMnemonic(targetMnemonic);
        await wClient.walletKeys.addKey(targetWallet.address, targetWallet.privateKey);

        const blockHeight = await wClient.blockchainAPI.getCurrentBlockHeight();
        for (let i = 0; i < 3; i++) {
            const id = await wClient.createPaymentTransaction(targetAddress, fundedAddress, amountToSendSatoshi.muln(15), undefined, undefined, undefined, blockHeight + 100);
            await waitForTxToFinishWithStatus(2, 10 * 60, wClient.rootEm, TransactionStatus.TX_SUCCESS, id);
        }
    });
});