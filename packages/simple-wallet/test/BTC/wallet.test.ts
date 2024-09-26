import { SpentHeightEnum, UTXOEntity, WALLET } from "../../src";
import {
    BitcoinWalletConfig,
    FeeServiceConfig,
    ICreateWalletResponse
} from "../../src/interfaces/IWalletTransaction";
import chaiAsPromised from "chai-as-promised";
import { assert, expect, use } from "chai";

use(chaiAsPromised);
import { toBN, toBNExp } from "../../src/utils/bnutils";
import { getTransactionInfoById } from "../../src/db/dbutils";
import { getCurrentTimestampInSeconds, sleepMs } from "../../src/utils/utils";
import {TransactionStatus} from "../../src/entity/transaction";
import { initializeTestMikroORM, ORM } from "../test-orm/mikro-orm.config";
import {UnprotectedDBWalletKeys} from "../test-orm/UnprotectedDBWalletKey";
import {
    addConsoleTransportForTests, calculateNewFeeForTx, clearUTXOs, createTransactionEntity,
    loop,
    resetMonitoringOnForceExit,
    setMonitoringStatus, waitForTxToBeReplacedWithStatus,
    waitForTxToFinishWithStatus,
} from "../test-util/util";
import {logger} from "../../src/utils/logger";
import BN from "bn.js";
import { BTC_DOGE_DEC_PLACES, ChainType, DEFAULT_FEE_INCREASE } from "../../src/utils/constants";
import { AxiosError } from "axios";
import * as dbutils from "../../src/db/dbutils";
import { DriverException } from "@mikro-orm/core";
import * as utxoUtils from "../../src/chain-clients/utxo/UTXOUtils";
import { ServiceRepository } from "../../src/ServiceRepository";
import { TransactionService } from "../../src/chain-clients/utxo/TransactionService";
import { createAxiosConfig } from "../../src/utils/axios-error-utils";
import { getCore } from "../../src/chain-clients/utxo/UTXOUtils";
import { BlockchainFeeService } from "../../src/fee-service/service";
import { BlockchainAPIWrapper } from "../../src/blockchain-apis/UTXOBlockchainAPIWrapper";
// eslint-disable-next-line @typescript-eslint/no-var-requires
const sinon = require("sinon");

const walletSecret = "wallet_secret";
// bitcoin test network with fundedAddress "mvvwChA3SRa5X8CuyvdT4sAcYNvN5FxzGE" at
// https://live.blockcypher.com/btc-testnet/address/mvvwChA3SRa5X8CuyvdT4sAcYNvN5FxzGE/

const BTCMccConnectionTestInitial = {
    url: process.env.BTC_URL ?? "",
    inTestnet: true,
    walletSecret: walletSecret
};
let BTCMccConnectionTest: BitcoinWalletConfig;
const feeServiceConfig: FeeServiceConfig = {
    indexerUrl: process.env.BTC_URL ?? "",
    sleepTimeMs: 1000,
    numberOfBlocksInHistory: 3,
};

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

const amountToSendSatoshi = toBN(10020);
const feeInSatoshi = toBN(12000);
const maxFeeInSatoshi = toBN(1100);
const note = "10000000000000000000000000000000000000000beefbeaddeafdeaddeedcac";

let wClient: WALLET.BTC;
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
            // feeServiceConfig: feeServiceConfig,
            enoughConfirmations: 2
        };
        wClient = await WALLET.BTC.initialize(BTCMccConnectionTest);

        await wClient.feeService?.setupHistory();
        void wClient.feeService?.startMonitoringFees();
        void wClient.startMonitoringTransactionProgress();

        await sleepMs(200);

        resetMonitoringOnForceExit(wClient);
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

    it("Should create transaction with custom fee", async () => {
        fundedWallet = wClient.createWalletFromMnemonic(fundedMnemonic);
        const txId = await wClient.createPaymentTransaction(fundedWallet.address, fundedWallet.privateKey, targetAddress, amountToSendSatoshi, feeInSatoshi);
        expect(txId).greaterThan(0);
        const [txEnt, ] = await waitForTxToFinishWithStatus(2, 2 * 60, wClient.rootEm, TransactionStatus.TX_SUBMITTED, txId);
        expect((txEnt.fee!).eq(feeInSatoshi)).to.be.true;
    });

    it("Should not create transaction: fee > maxFee", async () => {
        fundedWallet = wClient.createWalletFromMnemonic(fundedMnemonic);
        const txId = await wClient.createPaymentTransaction(fundedWallet.address, fundedWallet.privateKey, targetAddress, amountToSendSatoshi, feeInSatoshi, note, maxFeeInSatoshi);
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
        fundedWallet = wClient.createWalletFromMnemonic(fundedMnemonic);
        const currentBlock = await wClient.blockchainAPI.getCurrentBlockHeight();
        const id = await wClient.createPaymentTransaction(fundedWallet.address, fundedWallet.privateKey, targetAddress, amountToSendSatoshi, feeInSatoshi, undefined, feeInSatoshi, currentBlock.number - wClient.executionBlockOffset);
        expect(id).to.be.gt(0);

        const [txEnt] = await waitForTxToFinishWithStatus(2, 40, wClient.rootEm, TransactionStatus.TX_FAILED, id);
        expect(txEnt.status).to.equal(TransactionStatus.TX_FAILED);
    });

    it("Should submit TX_PREPARED that are in DB", async () => {
        fundedWallet = wClient.createWalletFromMnemonic(fundedMnemonic);
        const executeUntilBlock = (await wClient.blockchainAPI.getCurrentBlockHeight()).number + wClient.blockOffset;
        const txEnt = await createTransactionEntity(wClient.rootEm, ChainType.testBTC, fundedWallet.address, targetAddress, amountToSendSatoshi, feeInSatoshi, note, undefined, executeUntilBlock);
        const [transaction] = await ServiceRepository.get(wClient.chainType, TransactionService).preparePaymentTransaction(txEnt.id, txEnt.source, txEnt.destination, txEnt.amount ?? null, txEnt.fee, note);
        txEnt.raw = JSON.stringify(transaction);
        txEnt.status = TransactionStatus.TX_PREPARED;
        await wClient.rootEm.flush();
        const [tx] = await waitForTxToFinishWithStatus(2, 15 * 60, wClient.rootEm, TransactionStatus.TX_SUBMITTED, txEnt.id);
        expect(tx.status).to.equal(TransactionStatus.TX_SUBMITTED);
    });

    it("Should handle empty UTXO list in DB", async () => {
        fundedWallet = wClient.createWalletFromMnemonic(fundedMnemonic);
        await clearUTXOs(wClient.rootEm);
        const note = "10000000000000000000000000000000000000000beefbeaddeafdeaddeedcab";
        const id = await wClient.createPaymentTransaction(fundedWallet.address, fundedWallet.privateKey, targetAddress, amountToSendSatoshi, feeInSatoshi, note, undefined);
        expect(id).to.be.gt(0);
        await waitForTxToFinishWithStatus(2, 5 * 60, wClient.rootEm, TransactionStatus.TX_SUBMITTED, id);
    });

    it("Balance should change after transaction", async () => {
        fundedWallet = wClient.createWalletFromMnemonic(fundedMnemonic);
        const sourceBalanceStart = await wClient.getAccountBalance(fundedWallet.address);
        const targetBalanceStart = await wClient.getAccountBalance(targetAddress);
        const id = await wClient.createPaymentTransaction(fundedWallet.address, fundedWallet.privateKey, targetAddress, amountToSendSatoshi);
        expect(id).to.be.gt(0);
        await waitForTxToFinishWithStatus(2, 15 * 60, wClient.rootEm, TransactionStatus.TX_SUBMITTED, id);
        const sourceBalanceEnd = await wClient.getAccountBalance(fundedWallet.address);
        const targetBalanceEnd = await wClient.getAccountBalance(targetAddress);
        expect(sourceBalanceEnd.lt(sourceBalanceStart)).to.be.true;
        expect(targetBalanceEnd.gt(targetBalanceStart)).to.be.true;
    });

    it("Transaction with execute until timestamp too low should fail", async () => {
        fundedWallet = wClient.createWalletFromMnemonic(fundedMnemonic);
        const offset = wClient.executionBlockOffset * utxoUtils.getDefaultBlockTimeInSeconds(wClient.chainType)
        const id = await wClient.createPaymentTransaction(fundedWallet.address, fundedWallet.privateKey, targetAddress, amountToSendSatoshi, feeInSatoshi, undefined, undefined, undefined, toBN(getCurrentTimestampInSeconds() - offset));
        expect(id).to.be.gt(0);
        await waitForTxToFinishWithStatus(2, 30, wClient.rootEm, TransactionStatus.TX_FAILED, id);
    });

    it("Transaction with execute until timestamp too low should fail 2", async () => {
        fundedWallet = wClient.createWalletFromMnemonic(fundedMnemonic);
        const currentBlock = await wClient.blockchainAPI.getCurrentBlockHeight();
        const id = await wClient.createPaymentTransaction(fundedWallet.address, fundedWallet.privateKey, targetAddress, amountToSendSatoshi, feeInSatoshi, undefined, undefined, currentBlock.number, toBN(20240830203804));
        expect(id).to.be.gt(0);
        await waitForTxToFinishWithStatus(2, 30, wClient.rootEm, TransactionStatus.TX_FAILED, id);
    });

    it("Transaction with a too low fee should be updated with a higher fee", async () => {
        fundedWallet = wClient.createWalletFromMnemonic(fundedMnemonic);
        const startFee = toBNExp(0.0000000000001, 0);
        const id = await wClient.createPaymentTransaction(fundedWallet.address, fundedWallet.privateKey, targetAddress, amountToSendSatoshi, startFee, note, undefined);
        expect(id).to.be.gt(0);
        const [txEnt] = await waitForTxToFinishWithStatus(2, 15 * 60, wClient.rootEm, TransactionStatus.TX_SUBMITTED, id);
        expect(txEnt.fee?.toNumber()).to.be.gt(startFee.toNumber());
    });
//TODO
    it.skip("Already spent UTXOs with wrong status should get a new status - consistency checker", async () => {
        fundedWallet = wClient.createWalletFromMnemonic(fundedMnemonic);
        const id = await wClient.createPaymentTransaction(fundedWallet.address, fundedWallet.privateKey, targetAddress, amountToSendSatoshi, undefined, note, undefined);
        expect(id).to.be.gt(0);
        await waitForTxToFinishWithStatus(2, 15 * 60, wClient.rootEm, TransactionStatus.TX_SUCCESS, id);
        let utxoEnt;
        do {
            utxoEnt = await wClient.rootEm.findOne(UTXOEntity, { spentHeight: SpentHeightEnum.SPENT });
            await sleepMs(500);
        } while (!utxoEnt);
        utxoEnt.spentHeight = SpentHeightEnum.UNSPENT;
        await wClient.rootEm.persistAndFlush(utxoEnt);

        const id2 = await wClient.createPaymentTransaction(fundedWallet.address, fundedWallet.privateKey, targetAddress, amountToSendSatoshi, undefined, note, undefined);
        expect(id2).to.be.gt(0);
        utxoEnt = await wClient.rootEm.findOne(UTXOEntity, { spentHeight: SpentHeightEnum.SPENT });
        assert(utxoEnt !== null);
        assert(utxoEnt.spentHeight === SpentHeightEnum.SPENT);
    });

    it("Test blockchain API connection down", async () => {
        fundedWallet = wClient.createWalletFromMnemonic(fundedMnemonic);

        const id = await wClient.createPaymentTransaction(fundedWallet.address, fundedWallet.privateKey, targetAddress, amountToSendSatoshi, undefined, note, undefined);
        expect(id).to.be.gt(0);

        const interceptorId = wClient.blockchainAPI.client.interceptors.request.use(
            config => Promise.reject(`Down`),
        );
        await sleepMs(5000);
        console.info("API connection up");
        wClient.blockchainAPI.client.interceptors.request.eject(interceptorId);
        await waitForTxToFinishWithStatus(2, 15 * 60, wClient.rootEm, TransactionStatus.TX_SUBMITTED, id);
    });
//TODO
    it.skip("If getCurrentFeeRate is down the fee should be the default one", async () => {
        fundedWallet = wClient.createWalletFromMnemonic(fundedMnemonic);

        wClient.feeService = undefined;
        const interceptorId = wClient.blockchainAPI.client.interceptors.request.use(
            config => {
                if (config.url?.includes("fee")) {
                    return Promise.reject("Down");
                }
                return config;
            },
        );

        const id = await wClient.createPaymentTransaction(fundedWallet.address, fundedWallet.privateKey, targetAddress, amountToSendSatoshi, undefined, note, undefined);
        expect(id).to.be.gt(0);
        await waitForTxToFinishWithStatus(0.1, 5 * 60, wClient.rootEm, TransactionStatus.TX_SUBMITTED, id);

        const [dbFee, calculatedFee] = await calculateNewFeeForTx(id, utxoUtils.getDefaultFeePerKB(ChainType.testBTC).muln(wClient.feeIncrease), getCore(wClient.chainType), wClient.rootEm);
        expect(dbFee?.toNumber()).to.be.equal(calculatedFee);

        if (interceptorId) {
            wClient.blockchainAPI.client.interceptors.request.eject(interceptorId);
        }

        wClient.feeService = new BlockchainFeeService(feeServiceConfig);
    });
//TODO
    it.skip("If fee service is down the getCurrentFeeRate should be used", async () => {
        fundedWallet = wClient.createWalletFromMnemonic(fundedMnemonic);

        const fee = "0.005";
        const feeRateInSatoshi = toBNExp(fee, BTC_DOGE_DEC_PLACES).muln(wClient.feeIncrease ?? DEFAULT_FEE_INCREASE);

        const interceptorId = wClient.blockchainAPI.client.interceptors.response.use(
            response => {
                if (response.config.url?.includes("fee")) {
                    const value = {
                        ...response,
                        data: {
                            result: fee,
                            feeRate: fee,
                        },
                        status: 200, statusText: "OK", headers: {}, config: response.config,
                    };
                    return Promise.resolve(value);
                }
                return response;
            },
        );
        sinon.stub(ServiceRepository.get(wClient.chainType, BlockchainAPIWrapper), "getCurrentFeeRate").resolves(fee);

        const id = await wClient.createPaymentTransaction(fundedWallet.address, fundedWallet.privateKey, targetAddress, amountToSendSatoshi, undefined, note, undefined);
        expect(id).to.be.gt(0);

        await waitForTxToFinishWithStatus(2, 5 * 60, wClient.rootEm, TransactionStatus.TX_SUBMITTED, id);
        const [dbFee, calculatedFee] = await calculateNewFeeForTx(id, feeRateInSatoshi, getCore(wClient.chainType), wClient.rootEm);
        expect(dbFee?.toNumber()).to.be.equal(calculatedFee);

        wClient.blockchainAPI.client.interceptors.request.eject(interceptorId);
        sinon.restore();
    });

    it("If monitoring restarts wallet should run normally", async () => {
        fundedWallet = wClient.createWalletFromMnemonic(fundedMnemonic);
        const N = 2;
        await sleepMs(2000);
        await wClient.stopMonitoring();
        const isMonitoring = await wClient.isMonitoring();
        expect(isMonitoring).to.be.false;

        const initialTxIds = [];
        for (let i = 0; i < N; i++) {
            initialTxIds.push(await wClient.createPaymentTransaction(fundedWallet.address, fundedWallet.privateKey, targetAddress, amountToSendSatoshi));
        }
        await sleepMs(2000);
        void wClient.startMonitoringTransactionProgress();
        for (let i = 0; i < N; i++) {
            await waitForTxToFinishWithStatus(2, 5 * 60, wClient.rootEm, TransactionStatus.TX_SUBMITTED, initialTxIds[i]);
        }
    });

    // it("Should go to the fallback API", async () => { //TODO
    //     const bitcoreURL = "https://api.bitcore.io/api/BTC/testnet/";
    //     wClient.blockchainAPI.clients[bitcoreURL] = new BitcoreAPI(createAxiosConfig(ChainType.testBTC, bitcoreURL), undefined);
    //     const interceptorId = wClient.blockchainAPI.client.interceptors.request.use(
    //         config => {
    //             // Simulate a connection down scenario
    //             return Promise.reject(new AxiosError('Simulated connection down', 'ECONNABORTED'));
    //         },
    //         error => {
    //             return Promise.reject(error);
    //         }
    //     );
    //     const balance = await wClient.blockchainAPI.getAccountBalance(fundedAddress);
    //     expect(balance).to.be.gt(0);
    //     wClient.blockchainAPI.client.interceptors.request.eject(interceptorId);
    //     delete wClient.blockchainAPI.clients[bitcoreURL];
    // });

    it.skip("Stress test", async () => {
        // fundedWallet = wClient.createWalletFromMnemonic(fundedMnemonic);
        // targetWallet = wClient.createWalletFromMnemonic(targetMnemonic);
        //
        // const N = 60;
        // const wallets = [];
        //
        // for (let i = 0; i < N; i++) {
        //     wallets.push(wClient.createWalletFromMnemonic(TEST_DOGE_ACCOUNTS[i].mnemonic));
        //     console.info(wallets[i].address, (await wClient.getAccountBalance(wallets[i].address)).toNumber());
        // }
        //
        // const initialTxIds = await Promise.all(wallets.map(async (wallet, i) => {
        //     return await wClient.createPaymentTransaction(fundedWallet.address, fundedWallet.privateKey, wallet.address, amountToSendSatoshi);
        // }));
        //
        // // Wait for accounts to receive transactions
        // await Promise.all(initialTxIds.map(async txId => {
        //     await waitForTxToFinishWithStatus(2, 15 * 60, wClient.rootEm, TransactionStatus.TX_SUCCESS, txId);
        // }));
        //
        // for (let i = 0; i < N; i++) {
        //     console.info(wallets[i].address, (await wClient.getAccountBalance(wallets[i].address)).toNumber());
        // }
        //
        // const transferTxIds = await Promise.all(wallets.map(async wallet => {
        //     return await wClient.createPaymentTransaction(wallet.address, wallet.privateKey, fundedWallet.address, null);
        // }));
        //
        // await Promise.all(transferTxIds.map(async txId => {
        //     await waitForTxToFinishWithStatus(2, 15 * 60, wClient.rootEm, TransactionStatus.TX_SUCCESS, txId);
        // }));
    });

    //TODO- infinite loop
    it.skip("DB down after creating transaction", async () => {
        fundedWallet = wClient.createWalletFromMnemonic(fundedMnemonic);
        const id = await wClient.createPaymentTransaction(fundedWallet.address, fundedWallet.privateKey, targetAddress, amountToSendSatoshi);
        const txInfo = await getTransactionInfoById(wClient.rootEm, id);
        expect(txInfo.status).to.be.equal(TransactionStatus.TX_CREATED);

        await waitForTxToFinishWithStatus(0.001, 5 * 60, wClient.rootEm, TransactionStatus.TX_PREPARED, id);
        await testOrm.close();
        await sleepMs(5000);
        await testOrm.connect();
        await waitForTxToFinishWithStatus(1, 15 * 60, wClient.rootEm, TransactionStatus.TX_SUBMITTED, id);
    });

    it.skip("'updateTransactionEntity' is down", async () => {//TODO - memory leak
        fundedWallet = wClient.createWalletFromMnemonic(fundedMnemonic);

        const id = await wClient.createPaymentTransaction(fundedWallet.address, fundedWallet.privateKey, targetAddress, amountToSendSatoshi);

        await waitForTxToFinishWithStatus(0.01, 5 * 60, wClient.rootEm, TransactionStatus.TX_PREPARED, id);
        sinon.stub(dbutils, "updateTransactionEntity").throws(new DriverException(new Error("DB down")));

        await sleepMs(10000);
        sinon.restore();

        await waitForTxToFinishWithStatus(0.001, 5 * 60, wClient.rootEm, TransactionStatus.TX_SUBMITTED, id);
    });
//TODO
    it.skip("Should replace transaction by fee", async () => {
        fundedWallet = wClient.createWalletFromMnemonic(fundedMnemonic);
        const fee = toBN(1236);
        const currentBlock = await wClient.blockchainAPI.getCurrentBlockHeight();
        const id = await wClient.createPaymentTransaction(fundedWallet.address, fundedWallet.privateKey, targetAddress, amountToSendSatoshi, fee, undefined, undefined, currentBlock.number + 2 * wClient.executionBlockOffset);
        expect(id).to.be.gt(0);
        await waitForTxToFinishWithStatus(0.005, 50, wClient.rootEm, [TransactionStatus.TX_PREPARED, TransactionStatus.TX_REPLACED, TransactionStatus.TX_SUBMITTED], id);
        await waitForTxToBeReplacedWithStatus(2, 15 * 60, wClient, TransactionStatus.TX_SUCCESS, id);
    });
//TODO
    it.skip("Should replace transaction by fee", async () => {
        const fee = toBN(1236);
        fundedWallet = wClient.createWalletFromMnemonic(fundedMnemonic);
        const id = await wClient.createPaymentTransaction(fundedWallet.address, fundedWallet.privateKey, targetAddress, amountToSendSatoshi, fee, "10000000000000000000000000000000000000000beefbeaddeafdeaddeedca0");
        expect(id).to.be.gt(0);
        // await wClient.createPaymentTransaction(fundedWallet.address, fundedWallet.privateKey, targetAddress, amountToSendSatoshi, fee, "10000000000000000000000000000000000000000beefbeaddeafdeaddeedca1");
        // await wClient.createPaymentTransaction(fundedWallet.address, fundedWallet.privateKey, targetAddress, amountToSendSatoshi, fee, "10000000000000000000000000000000000000000beefbeaddeafdeaddeedca2");
        // await wClient.createPaymentTransaction(fundedWallet.address, fundedWallet.privateKey, targetAddress, amountToSendSatoshi, fee, "10000000000000000000000000000000000000000beefbeaddeafdeaddeedca3");
        // await wClient.createPaymentTransaction(fundedWallet.address, fundedWallet.privateKey, targetAddress, amountToSendSatoshi, fee, "10000000000000000000000000000000000000000beefbeaddeafdeaddeedca4");
        // await wClient.createPaymentTransaction(fundedWallet.address, fundedWallet.privateKey, targetAddress, amountToSendSatoshi, fee, "10000000000000000000000000000000000000000beefbeaddeafdeaddeedca5");
        // await wClient.createPaymentTransaction(fundedWallet.address, fundedWallet.privateKey, targetAddress, amountToSendSatoshi, feeInSatoshi.divn(22), "10000000000000000000000000000000000000000beefbeaddeafdeaddeedca6");
        // await wClient.createPaymentTransaction(fundedWallet.address, fundedWallet.privateKey, targetAddress, amountToSendSatoshi, feeInSatoshi.divn(22), "10000000000000000000000000000000000000000beefbeaddeafdeaddeedca7");
        // await wClient.createPaymentTransaction(fundedWallet.address, fundedWallet.privateKey, targetAddress, amountToSendSatoshi, feeInSatoshi.divn(22), "10000000000000000000000000000000000000000beefbeaddeafdeaddeedca8");

        await waitForTxToFinishWithStatus(0.005, 50, wClient.rootEm, [TransactionStatus.TX_PREPARED, TransactionStatus.TX_REPLACED, TransactionStatus.TX_SUBMITTED], id);

        await waitForTxToBeReplacedWithStatus(2, 15 * 60, wClient, TransactionStatus.TX_SUBMITTED, id);
    });

    it.skip("Monitoring into infinity", async () => {
        while (true) {
            await sleepMs(2000);
        }
    });

    it.skip("Should prepare and execute transaction", async () => {// Needed only to transfer funds
        const source = "";
        const source_pk = "";
        const target = "";
        const amountToSendInSats = toBN("");
        const noteToSend = "Transfer";
        const id = await wClient.createPaymentTransaction(source, source_pk, target, amountToSendInSats, undefined, noteToSend);
        expect(id).to.be.gt(0);
        await waitForTxToFinishWithStatus(2, 15 * 60, wClient.rootEm, TransactionStatus.TX_SUCCESS, id);
    });
});