import { SpentHeightEnum, TransactionStatus, UTXOEntity, WALLET } from "../../src";
import { DogecoinWalletConfig, FeeServiceConfig, ICreateWalletResponse } from "../../src/interfaces/IWalletTransaction";
import chaiAsPromised from "chai-as-promised";
import { assert, expect, use } from "chai";
import WAValidator from "wallet-address-validator";
import { BTC_DOGE_DEC_PLACES, ChainType, DEFAULT_FEE_INCREASE, DOGE_DUST_AMOUNT } from "../../src/utils/constants";
import { toBNExp, toNumber } from "../../src/utils/bnutils";
import rewire from "rewire";
import { initializeTestMikroORM, ORM } from "../test-orm/mikro-orm.config";
import { UnprotectedDBWalletKeys } from "../test-orm/UnprotectedDBWalletKey";
import {
    addConsoleTransportForTests,
    calculateNewFeeForTx,
    clearUTXOs,
    createTransactionEntity,
    loop,
    resetMonitoringOnForceExit,
    setMonitoringStatus,
    waitForTxToBeReplacedWithStatus,
    waitForTxToFinishWithStatus,
} from "../test_util/util";
import BN from "bn.js";
import { logger } from "../../src/utils/logger";
import { getCurrentTimestampInSeconds, getDefaultFeePerKB, sleepMs } from "../../src/utils/utils";
import { TEST_DOGE_ACCOUNTS } from "./accounts";
import * as dbutils from "../../src/db/dbutils";
import { getTransactionInfoById } from "../../src/db/dbutils";
import { DriverException } from "@mikro-orm/core";
import * as utxoUtils from "../../src/chain-clients/utxo/UTXOUtils";
import { getCore } from "../../src/chain-clients/utxo/UTXOUtils";
import { toBN } from "web3-utils";
import { BitcoreAPI } from "../../src/blockchain-apis/BitcoreAPI";
import { AxiosError } from "axios";
import { ServiceRepository } from "../../src/ServiceRepository";
import { TransactionService } from "../../src/chain-clients/utxo/TransactionService";
import { TransactionFeeService } from "../../src/chain-clients/utxo/TransactionFeeService"
import { createAxiosConfig } from "../../src/utils/axios-error-utils";
// eslint-disable-next-line @typescript-eslint/no-var-requires
const sinon = require("sinon");

use(chaiAsPromised);

const rewiredUTXOWalletImplementation = rewire("../../src/chain-clients/implementations/DogeWalletImplementation");
const rewiredUTXOWalletImplementationClass = rewiredUTXOWalletImplementation.__get__("DogeWalletImplementation");

const blockchainAPI = "blockbook";
const DOGEMccConnectionTestInitial = {
    url: process.env.BLOCKBOOK_DOGE_URL ?? "",
    username: "",
    password: "",
    inTestnet: true,
};
const feeServiceConfig: FeeServiceConfig = {
    indexerUrl: process.env.BLOCKBOOK_DOGE_URL ?? "",
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
    addres: "np3gXRRAfJ1fbw3pnkdDR96sbmhEdFjq3v",
    privateKey: "ciCVd1m6gFJ2PTRuWjrmXK2KRBLkY8RzgCJ9pqfmqm1XT6L7pXwM",
};

const targetFirstChange = {
    xpub: "vpub5YEVpE5aqVJiEos7Z1iQgQPcdSM7nfQNB8dfdW7zDGGQrp3MUk2e5aAaCgfsyeQryUHHgxWGteYqkPfCBCpnEGAcqxaFpWAZ7ByJsvXPPzJ",
    address: "nkatKfFLa5wXbtuMHM5vN9qJ3v7UPfkBU9",
    privateKey: "cgAnaNqPmVUr3Am1VAzGX9zGEVw5AJ2FWMYw65dBGnUUJs4iTEkP",
};

const note = "10000000000000000000000000000000000000000beefbeaddeafdeaddeedcab";


const DOGE_DECIMAL_PLACES = BTC_DOGE_DEC_PLACES;
const amountToSendInSatoshi = toBNExp(1.5, DOGE_DECIMAL_PLACES);
const feeInSatoshi = toBNExp(2, DOGE_DECIMAL_PLACES);
const maxFeeInSatoshi = toBNExp(1.5, DOGE_DECIMAL_PLACES);

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
            api: blockchainAPI,
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
        // addRequestTimers(wClient);

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


    it("Should create account", async () => {
        const newAccount = wClient.createWallet();
        expect(newAccount.address).to.not.be.null;

        fundedWallet = wClient.createWalletFromMnemonic(fundedMnemonic);
        expect(fundedWallet.address).to.eq(fundedAddress);
        const targetWallet = wClient.createWalletFromMnemonic(targetMnemonic);
        expect(targetWallet.address).to.eq(targetAddress);

        expect(WAValidator.validate(newAccount.address, "DOGE", "testnet")).to.be.true;
        expect(WAValidator.validate(fundedWallet.address, "DOGE", "testnet")).to.be.true;
        expect(WAValidator.validate(targetWallet.address, "DOGE", "testnet")).to.be.true;

        logger.info(fundedWallet);
    });

    it("Should prepare and execute transaction", async () => {
        fundedWallet = wClient.createWalletFromMnemonic(fundedMnemonic);
        const id = await wClient.createPaymentTransaction(fundedWallet.address, fundedWallet.privateKey, targetAddress, amountToSendInSatoshi, feeInSatoshi, note, undefined);
        expect(id).to.be.gt(0);
        await waitForTxToFinishWithStatus(2, 15 * 60, wClient.rootEm, TransactionStatus.TX_SUCCESS, id);
    });

    it("Should not submit transaction: fee > maxFee", async () => {
        fundedWallet = wClient.createWalletFromMnemonic(fundedMnemonic);
        const id = await wClient.createPaymentTransaction(fundedWallet.address, fundedWallet.privateKey, targetAddress, amountToSendInSatoshi, feeInSatoshi, "Submit", maxFeeInSatoshi);
        expect(id).to.be.gt(0);

        const [txEnt] = await waitForTxToFinishWithStatus(2, 30, wClient.rootEm, TransactionStatus.TX_FAILED, id);
        expect(txEnt.maxFee!.lt(txEnt.fee!)).to.be.true;
    });

    it("Should not create transaction: amount = dust amount", async () => {
        fundedWallet = wClient.createWalletFromMnemonic(fundedMnemonic);
        await expect(ServiceRepository.get(wClient.chainType, TransactionService).preparePaymentTransaction(0, fundedWallet.address, targetAddress, DOGE_DUST_AMOUNT, feeInSatoshi, "Note")).to
            .eventually.be.rejectedWith(`Will not prepare transaction 0, for ${fundedWallet.address}. Amount ${DOGE_DUST_AMOUNT.toString()} is less than dust ${DOGE_DUST_AMOUNT.toString()}`);
    });

    it("Should receive fee", async () => {
        const fee = await wClient.getCurrentTransactionFee({
            source: fundedAddress,
            amount: amountToSendInSatoshi,
            destination: targetAddress,
        });
        expect(fee).not.to.be.null;
    });

    it("Should receive latest blockHeight", async () => {
        const index = await wClient.blockchainAPI.getCurrentBlockHeight();
        expect(index).not.to.be.null;
    });

    it.skip("Should delete account", async () => {
        const targetWallet = wClient.createWalletFromMnemonic(targetMnemonic);
        const balance = await wClient.getAccountBalance(targetWallet.address);
        // delete toDelete account
        const id = await wClient.createDeleteAccountTransaction(targetWallet.address, targetWallet.privateKey, fundedAddress, undefined, note);

        await waitForTxToFinishWithStatus(2, 15 * 60, wClient.rootEm, TransactionStatus.TX_SUCCESS, id);
        const balance2 = await wClient.getAccountBalance(targetWallet.address);
        expect(balance.gt(balance2));
    });

    it("Should get account balance", async () => {
        fundedWallet = wClient.createWalletFromMnemonic(fundedMnemonic);
        const accountBalance = await wClient.getAccountBalance(fundedWallet.address);
        expect(accountBalance.gt(new BN(0))).to.be.true;
    });

    it("Should get sub-account balances", async () => {
        const balanceMain = await wClient.getAccountBalance(fundedAddress);
        const balanceSub = await wClient.getAccountBalance(fundedFirstChange.addres);
        const balanceMainAndSub = await wClient.getAccountBalance(fundedAddress, [fundedFirstChange.addres]);

        expect(balanceSub.add(balanceMain).toNumber()).to.be.equal(balanceMainAndSub.toNumber());
    });

    it("Transaction with executeUntilBlock before current block height should fail", async () => {
        fundedWallet = wClient.createWalletFromMnemonic(fundedMnemonic);

        const currentBlock = await wClient.blockchainAPI.getCurrentBlockHeight();
        const id = await wClient.createPaymentTransaction(fundedWallet.address, fundedWallet.privateKey, targetAddress, amountToSendInSatoshi, feeInSatoshi, "Submit", feeInSatoshi, currentBlock.number - 5);
        expect(id).to.be.gt(0);

        const [txEnt] = await waitForTxToFinishWithStatus(2, 40, wClient.rootEm, TransactionStatus.TX_FAILED, id);
        expect(txEnt.status).to.equal(TransactionStatus.TX_FAILED);
    });

    it("Transaction with executeUntilBlock too low should fail (executeUntilBlock - currentBlockHeight < executionBlockOffset)", async () => {
        fundedWallet = wClient.createWalletFromMnemonic(fundedMnemonic);

        const currentBlock = await wClient.blockchainAPI.getCurrentBlockHeight();
        const id = await wClient.createPaymentTransaction(fundedWallet.address, fundedWallet.privateKey, targetAddress, amountToSendInSatoshi, feeInSatoshi, "Submit", feeInSatoshi, currentBlock.number + 1);
        expect(id).to.be.gt(0);

        const [txEnt] = await waitForTxToFinishWithStatus(2, 40, wClient.rootEm, TransactionStatus.TX_FAILED, id);
        expect(txEnt.status).to.equal(TransactionStatus.TX_FAILED);
    });

    it("Should submit TX_PREPARED that are in DB", async () => {
        fundedWallet = wClient.createWalletFromMnemonic(fundedMnemonic);

        const executeUntilBlock = (await wClient.blockchainAPI.getCurrentBlockHeight()).number + wClient.blockOffset;
        const txEnt = await createTransactionEntity(wClient.rootEm, ChainType.testDOGE, fundedWallet.address, targetAddress, amountToSendInSatoshi, feeInSatoshi, note, undefined, executeUntilBlock);
        const [transaction] = await ServiceRepository.get(wClient.chainType, TransactionService).preparePaymentTransaction(txEnt.id, txEnt.source, txEnt.destination, txEnt.amount ?? null, txEnt.fee, note);
        txEnt.raw = JSON.stringify(transaction);
        txEnt.status = TransactionStatus.TX_PREPARED;
        await wClient.rootEm.flush();

        const [tx] = await waitForTxToFinishWithStatus(2, 15 * 60, wClient.rootEm, TransactionStatus.TX_SUCCESS, txEnt.id);
        expect(tx.status).to.equal(TransactionStatus.TX_SUCCESS);
    });

    it("Should handle TX_PENDING that are in DB", async () => {
        fundedWallet = wClient.createWalletFromMnemonic(fundedMnemonic);

        const rewired = await setupRewiredWallet();
        const fee = feeInSatoshi;
        const executeUntilBlock = (await wClient.blockchainAPI.getCurrentBlockHeight()).number + wClient.blockOffset;
        const txEnt = await createTransactionEntity(wClient.rootEm, ChainType.testDOGE, fundedWallet.address, targetAddress, amountToSendInSatoshi, fee, note, undefined, executeUntilBlock);
        const [transaction] = await ServiceRepository.get(wClient.chainType, TransactionService).preparePaymentTransaction(txEnt.id, fundedWallet.address, targetAddress, amountToSendInSatoshi, fee, note);
        const signed = await rewired.signTransaction(transaction, fundedWallet.privateKey);

        txEnt.raw = JSON.stringify(transaction);
        txEnt.transactionHash = signed.txHash;
        await wClient.rootEm.flush();
        await rewired.submitTransaction(signed.txBlob, txEnt.id);

        const [tx] = await waitForTxToFinishWithStatus(2, 15 * 60, wClient.rootEm, TransactionStatus.TX_SUCCESS, txEnt.id);
        expect(tx.status).to.equal(TransactionStatus.TX_SUCCESS);
    });

    it("Should handle empty UTXO list in DB", async () => {
        fundedWallet = wClient.createWalletFromMnemonic(fundedMnemonic);
        await clearUTXOs(wClient.rootEm);
        const note = "10000000000000000000000000000000000000000beefbeaddeafdeaddeedcab";
        const id = await wClient.createPaymentTransaction(fundedWallet.address, fundedWallet.privateKey, targetAddress, amountToSendInSatoshi, feeInSatoshi, note, undefined);
        expect(id).to.be.gt(0);

        await waitForTxToFinishWithStatus(2, 15 * 60, wClient.rootEm, TransactionStatus.TX_SUCCESS, id);
    });

    it("Balance should change after transaction", async () => {
        fundedWallet = wClient.createWalletFromMnemonic(fundedMnemonic);

        const sourceBalanceStart = await wClient.getAccountBalance(fundedWallet.address);
        const targetBalanceStart = await wClient.getAccountBalance(targetAddress);

        const id = await wClient.createPaymentTransaction(fundedWallet.address, fundedWallet.privateKey, targetAddress, amountToSendInSatoshi, feeInSatoshi, note, undefined);
        expect(id).to.be.gt(0);
        await waitForTxToFinishWithStatus(2, 15 * 60, wClient.rootEm, TransactionStatus.TX_SUCCESS, id);

        const sourceBalanceEnd = await wClient.getAccountBalance(fundedWallet.address);
        const targetBalanceEnd = await wClient.getAccountBalance(targetAddress);

        expect(sourceBalanceEnd.add(feeInSatoshi).add(amountToSendInSatoshi).toNumber()).to.equal(sourceBalanceStart.toNumber());
        expect(targetBalanceStart.add(amountToSendInSatoshi).toNumber()).to.be.equal(targetBalanceEnd.toNumber());
    });

    it("Transaction with execute until timestamp too low should fail", async () => {
        fundedWallet = wClient.createWalletFromMnemonic(fundedMnemonic);

        const id = await wClient.createPaymentTransaction(fundedWallet.address, fundedWallet.privateKey, targetAddress, amountToSendInSatoshi, feeInSatoshi.divn(2), "Submit", undefined, undefined, toBN(getCurrentTimestampInSeconds() - 24 * 60 * 60));
        expect(id).to.be.gt(0);

        await waitForTxToFinishWithStatus(2, 30, wClient.rootEm, TransactionStatus.TX_FAILED, id);
    });

    it("Transaction with a too low fee should be updated with a higher fee", async () => {
        fundedWallet = wClient.createWalletFromMnemonic(fundedMnemonic);

        const startFee = toBNExp(0.0000000000001, 0);
        const id = await wClient.createPaymentTransaction(fundedWallet.address, fundedWallet.privateKey, targetAddress, amountToSendInSatoshi, startFee, note, undefined);
        expect(id).to.be.gt(0);
        const [txEnt] = await waitForTxToFinishWithStatus(2, 15 * 60, wClient.rootEm, TransactionStatus.TX_SUCCESS, id);
        expect(txEnt.fee?.toNumber()).to.be.gt(startFee.toNumber());
    });

    it("Already spent UTXOs with wrong status should get a new status - consistency checker", async () => {
        fundedWallet = wClient.createWalletFromMnemonic(fundedMnemonic);

        const id = await wClient.createPaymentTransaction(fundedWallet.address, fundedWallet.privateKey, targetAddress, amountToSendInSatoshi, undefined, note, undefined);
        expect(id).to.be.gt(0);
        await waitForTxToFinishWithStatus(2, 15 * 60, wClient.rootEm, TransactionStatus.TX_SUCCESS, id);

        let utxoEnt;
        do {
            utxoEnt = await wClient.rootEm.findOne(UTXOEntity, { spentHeight: SpentHeightEnum.SPENT });
            await sleepMs(500);
        } while (!utxoEnt);

        utxoEnt.spentHeight = SpentHeightEnum.UNSPENT;
        await wClient.rootEm.persistAndFlush(utxoEnt);

        const id2 = await wClient.createPaymentTransaction(fundedWallet.address, fundedWallet.privateKey, targetAddress, amountToSendInSatoshi, undefined, note, undefined);
        expect(id2).to.be.gt(0);

        utxoEnt = await wClient.rootEm.findOne(UTXOEntity, { spentHeight: SpentHeightEnum.SPENT });
        assert(utxoEnt !== null);
        assert(utxoEnt.spentHeight === SpentHeightEnum.SPENT);
    });

    it("Test blockchain API connection down", async () => {
        fundedWallet = wClient.createWalletFromMnemonic(fundedMnemonic);

        const id = await wClient.createPaymentTransaction(fundedWallet.address, fundedWallet.privateKey, targetAddress, amountToSendInSatoshi, undefined, note, undefined);
        expect(id).to.be.gt(0);

        const interceptorId = wClient.blockchainAPI.client.interceptors.request.use(
            config => Promise.reject(`Down`),
        );
        await sleepMs(5000);
        console.info("API connection up");
        wClient.blockchainAPI.client.interceptors.request.eject(interceptorId);
        await waitForTxToFinishWithStatus(2, 15 * 60, wClient.rootEm, TransactionStatus.TX_SUCCESS, id);
    });

    it("If getCurrentFeeRate is down the fee should be the default one", async () => {
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

        const id = await wClient.createPaymentTransaction(fundedWallet.address, fundedWallet.privateKey, targetAddress, amountToSendInSatoshi, undefined, note, undefined);
        expect(id).to.be.gt(0);
        await waitForTxToFinishWithStatus(0.1, 15 * 60, wClient.rootEm, TransactionStatus.TX_SUBMITTED, id);

        const [dbFee, calculatedFee] = await calculateNewFeeForTx(id, getDefaultFeePerKB(ChainType.testDOGE), getCore((await setupRewiredWallet()).chainType), wClient.rootEm);
        expect(dbFee?.toNumber()).to.be.equal(calculatedFee);

        wClient.blockchainAPI.client.interceptors.request.eject(interceptorId);
        console.info();
    });

    it("If fee service is down the getCurrentFeeRate should be used", async () => {
        fundedWallet = wClient.createWalletFromMnemonic(fundedMnemonic);

        const fee = "0.1";
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
        const id = await wClient.createPaymentTransaction(fundedWallet.address, fundedWallet.privateKey, targetAddress, amountToSendInSatoshi, undefined, note, undefined);
        expect(id).to.be.gt(0);

        await waitForTxToFinishWithStatus(2, 15 * 60, wClient.rootEm, TransactionStatus.TX_SUCCESS, id);
        const [dbFee, calculatedFee] = await calculateNewFeeForTx(id, feeRateInSatoshi, getCore((await setupRewiredWallet()).chainType), wClient.rootEm);
        expect(dbFee?.toNumber()).to.be.equal(calculatedFee);

        wClient.blockchainAPI.client.interceptors.request.eject(interceptorId);
    });

    it("If monitoring restarts wallet should run normally", async () => {
        fundedWallet = wClient.createWalletFromMnemonic(fundedMnemonic);

        const N = 2;
        const amountToSendInSatoshi = toBNExp(2, DOGE_DECIMAL_PLACES);

        await sleepMs(2000);
        await wClient.stopMonitoring();

        const isMonitoring = await wClient.isMonitoring();
        expect(isMonitoring).to.be.false;

        const initialTxIds = [];
        for (let i = 0; i < N; i++) {
            initialTxIds.push(await wClient.createPaymentTransaction(fundedWallet.address, fundedWallet.privateKey, targetAddress, amountToSendInSatoshi));
        }

        await sleepMs(2000);
        void wClient.startMonitoringTransactionProgress();

        for (let i = 0; i < N; i++) {
            await waitForTxToFinishWithStatus(2, 15 * 60, wClient.rootEm, TransactionStatus.TX_SUCCESS, initialTxIds[i]);
        }
    });

    it("Should go to the fallback API", async () => {
        const bitcoreURL = "https://api.bitcore.io/api/DOGE/testnet/";
        wClient.blockchainAPI.clients[bitcoreURL] = new BitcoreAPI(createAxiosConfig(ChainType.testDOGE, bitcoreURL), undefined);

        const interceptorId = wClient.blockchainAPI.client.interceptors.request.use(
            config => {
                // Simulate a connection down scenario
                return Promise.reject(new AxiosError('Simulated connection down', 'ECONNABORTED'));
            },
            error => {
                return Promise.reject(error);
            }
        );

        const balance = await wClient.blockchainAPI.getAccountBalance(fundedAddress);
        expect(balance).to.be.gte(0);
        wClient.blockchainAPI.client.interceptors.request.eject(interceptorId);
        delete wClient.blockchainAPI.clients[bitcoreURL];
    });

    it.skip("Stress test", async () => {
        fundedWallet = wClient.createWalletFromMnemonic(fundedMnemonic);
        targetWallet = wClient.createWalletFromMnemonic(targetMnemonic);

        const N = 60;
        const wallets = [];
        const amountToSendInSatoshi = toBNExp(1, DOGE_DECIMAL_PLACES);

        for (let i = 0; i < N; i++) {
            wallets.push(wClient.createWalletFromMnemonic(TEST_DOGE_ACCOUNTS[i].mnemonic));
            console.info(wallets[i].address, (await wClient.getAccountBalance(wallets[i].address)).toNumber());
        }

        const initialTxIds = await Promise.all(wallets.map(async (wallet, i) => {
            return await wClient.createPaymentTransaction(fundedWallet.address, fundedWallet.privateKey, wallet.address, amountToSendInSatoshi);
        }));

        // Wait for accounts to receive transactions
        await Promise.all(initialTxIds.map(async txId => {
            await waitForTxToFinishWithStatus(2, 15 * 60, wClient.rootEm, TransactionStatus.TX_SUCCESS, txId);
        }));

        for (let i = 0; i < N; i++) {
            console.info(wallets[i].address, (await wClient.getAccountBalance(wallets[i].address)).toNumber());
        }

        const transferTxIds = await Promise.all(wallets.map(async wallet => {
            return await wClient.createPaymentTransaction(wallet.address, wallet.privateKey, fundedWallet.address, null);
        }));

        await Promise.all(transferTxIds.map(async txId => {
            await waitForTxToFinishWithStatus(2, 15 * 60, wClient.rootEm, TransactionStatus.TX_SUCCESS, txId);
        }));
    });

    it("DB down after creating transaction", async () => {
        fundedWallet = wClient.createWalletFromMnemonic(fundedMnemonic);

        const id = await wClient.createPaymentTransaction(fundedWallet.address, fundedWallet.privateKey, targetAddress, amountToSendInSatoshi);
        const txInfo = await getTransactionInfoById(wClient.rootEm, id);
        expect(txInfo.status).to.be.equal(TransactionStatus.TX_CREATED);

        await waitForTxToFinishWithStatus(0.001, 15 * 60, wClient.rootEm, TransactionStatus.TX_PREPARED, id);
        await testOrm.close();
        await sleepMs(5000);
        await testOrm.connect();

        await waitForTxToFinishWithStatus(1, 15 * 60, wClient.rootEm, TransactionStatus.TX_SUCCESS, id);
    });

    it("updateTransactionEntity down", async () => {
        fundedWallet = wClient.createWalletFromMnemonic(fundedMnemonic);

        const id = await wClient.createPaymentTransaction(fundedWallet.address, fundedWallet.privateKey, targetAddress, amountToSendInSatoshi);

        await waitForTxToFinishWithStatus(0.01, 15 * 60, wClient.rootEm, TransactionStatus.TX_PREPARED, id);
        sinon.stub(dbutils, "updateTransactionEntity").throws(new DriverException(new Error("DB down")));

        await sleepMs(10000);
        sinon.restore();

        await waitForTxToFinishWithStatus(0.001, 15 * 60, wClient.rootEm, TransactionStatus.TX_SUCCESS, id);
    });

    it.skip("Monitoring into infinity", async () => {
        while (true) {
            await sleepMs(2000);
        }
    });


    it("Should replace transaction", async () => {
        fundedWallet = wClient.createWalletFromMnemonic(fundedMnemonic);

        const stub = sinon.stub(ServiceRepository.get(wClient.chainType, TransactionFeeService), "hasTooHighOrLowFee");
        stub.returns(false);

        const id = await wClient.createPaymentTransaction(fundedWallet.address, fundedWallet.privateKey, targetAddress, toBN("1000001"), toBN("100"), note, undefined);
        expect(id).to.be.gt(0);

        // Wait for TX to be written into db and then reset the logic for fees
        await waitForTxToFinishWithStatus(0.005, 50, wClient.rootEm, [TransactionStatus.TX_PREPARED, TransactionStatus.TX_REPLACED, TransactionStatus.TX_SUBMITTED], id);
        stub.restore();

        await waitForTxToBeReplacedWithStatus(2, 15 * 60, wClient, TransactionStatus.TX_SUCCESS, id);
    });

    it("Should replace chain of transactions", async () => {
        const addressWithMnemonic = TEST_DOGE_ACCOUNTS[90];

        fundedWallet = wClient.createWalletFromMnemonic(fundedMnemonic);
        const testWallet = wClient.createWalletFromMnemonic(addressWithMnemonic.mnemonic);

        const id = await wClient.createPaymentTransaction(fundedWallet.address, fundedWallet.privateKey, testWallet.address, amountToSendInSatoshi.muln(1.5));
        await waitForTxToFinishWithStatus(2, 15 * 60, wClient.rootEm, TransactionStatus.TX_SUCCESS, id);

        const stub = sinon.stub(utxoUtils, "hasTooHighOrLowFee");
        const id2 = await wClient.createPaymentTransaction(testWallet.address, testWallet.privateKey, fundedWallet.address, toBN("1000001"), toBN("50000"), note);
        const id3 = await wClient.createPaymentTransaction(testWallet.address, testWallet.privateKey, fundedWallet.address, toBN("1000002"), toBN("51000"), note);
        await waitForTxToFinishWithStatus(0.5, 50, wClient.rootEm, [TransactionStatus.TX_PREPARED, TransactionStatus.TX_REPLACED, TransactionStatus.TX_SUBMITTED, TransactionStatus.TX_SUCCESS], id3);
        stub.restore();

        await waitForTxToBeReplacedWithStatus(2, 15 * 60, wClient, TransactionStatus.TX_SUCCESS, id2);
        await waitForTxToFinishWithStatus(2, 15 * 60, wClient.rootEm, TransactionStatus.TX_SUCCESS, id3);
    });

});

async function setupRewiredWallet() {
    const testOrm = await initializeTestMikroORM();
    const unprotectedDBWalletKeys = new UnprotectedDBWalletKeys(testOrm.em);
    DOGEMccConnectionTest = {
        ...DOGEMccConnectionTestInitial,
        api: blockchainAPI,
        em: testOrm.em,
        walletKeys: unprotectedDBWalletKeys,
        feeServiceConfig: feeServiceConfig,
    };
    const rewired = new rewiredUTXOWalletImplementationClass(DOGEMccConnectionTest);
    fundedWallet = rewired.createWalletFromMnemonic(fundedMnemonic);

    return rewired;
}
