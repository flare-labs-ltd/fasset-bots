import { SpentHeightEnum, UTXOEntity, WALLET } from "../../src";
import {
    BitcoinWalletConfig,
    FeeServiceConfig,
    ICreateWalletResponse
} from "../../src/interfaces/IWalletTransaction";
import chaiAsPromised from "chai-as-promised";
import { assert, expect, use } from "chai";

use(chaiAsPromised);
import WAValidator from "wallet-address-validator";
import { toBN, toBNExp } from "../../src/utils/bnutils";
import rewire from "rewire";
import { fetchTransactionEntityById, fetchMonitoringState, getTransactionInfoById } from "../../src/db/dbutils";
import { getDefaultFeePerKB, sleepMs } from "../../src/utils/utils";
import {TransactionStatus} from "../../src/entity/transaction";
import { initializeTestMikroORM, ORM } from "../test-orm/mikro-orm.config";
import {UnprotectedDBWalletKeys} from "../test-orm/UnprotectedDBWalletKey";
import {
    addConsoleTransportForTests, calculateNewFeeForTx, clearUTXOs, createTransactionEntity,
    loop,
    resetMonitoringOnForceExit,
    setMonitoringStatus, waitForTxToBeReplacedWithStatus,
    waitForTxToFinishWithStatus,
} from "../test_util/util";
import {logger} from "../../src/utils/logger";
import BN from "bn.js";
import { BTC_DOGE_DEC_PLACES, ChainType, DEFAULT_FEE_INCREASE } from "../../src/utils/constants";
import { getCore } from "../../src/chain-clients/utxo/UTXOUtils";
import { BitcoreAPI } from "../../src/blockchain-apis/BitcoreAPI";
import { createAxiosConfig } from "../../src/chain-clients/utils";
import { AxiosError } from "axios";
import * as dbutils from "../../src/db/dbutils";
import { DriverException } from "@mikro-orm/core";
import * as utxoUtils from "../../src/chain-clients/utxo/UTXOUtils";
import { BTC_TEST_ACCOUNTS } from "./btc_test_accounts";
import { ServiceRepository } from "../../src/ServiceRepository";
import { TransactionService } from "../../src/chain-clients/utxo/TransactionService";
// eslint-disable-next-line @typescript-eslint/no-var-requires
const sinon = require("sinon");

const rewiredUTXOWalletImplementation = rewire("../../src/chain-clients/implementations/BtcWalletImplementation");
const rewiredUTXOWalletImplementationClass = rewiredUTXOWalletImplementation.__get__("BtcWalletImplementation");
const walletSecret = "wallet_secret";
// bitcoin test network with fundedAddress "mvvwChA3SRa5X8CuyvdT4sAcYNvN5FxzGE" at
// https://live.blockcypher.com/btc-testnet/address/mvvwChA3SRa5X8CuyvdT4sAcYNvN5FxzGE/

const blockchainAPI = "blockbook";
const BTCMccConnectionTestInitial = {
    url: process.env.BLOCKBOOK_BTC_URL ?? "",
    username: "",
    password: "",
    apiTokenKey: process.env.FLARE_API_PORTAL_KEY ?? "",
    inTestnet: true,
    walletSecret: walletSecret
};
let BTCMccConnectionTest: BitcoinWalletConfig;
const feeServiceConfig: FeeServiceConfig = {
    indexerUrl: process.env.BLOCKBOOK_BTC_URL ?? "",
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

const amountToSendSatoshi = toBN(10000);
const feeInSatoshi = toBN(1200);
const maxFeeInSatoshi = toBN(1100);
const note = "10000000000000000000000000000000000000000beefbeaddeafdeaddeedcac";

let wClient: WALLET.BTC;
let fundedWallet: ICreateWalletResponse;
let targetWallet: ICreateWalletResponse;
let testOrm: ORM;

describe("Bitcoin wallet tests", () => {
    let removeConsoleLogging: () => void;

    before(async () => {
        removeConsoleLogging = addConsoleTransportForTests(logger);

        testOrm = await initializeTestMikroORM();
        const unprotectedDBWalletKeys = new UnprotectedDBWalletKeys(testOrm.em);
        BTCMccConnectionTest = {
            ...BTCMccConnectionTestInitial,
            api: blockchainAPI,
            em: testOrm.em,
            walletKeys: unprotectedDBWalletKeys,
            feeServiceConfig: feeServiceConfig,
            enoughConfirmations: 1
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

    it("Should create account", async () => {
        const newAccount = wClient.createWallet();
        expect(newAccount.address).to.not.be.null;
        expect(WAValidator.validate(newAccount.address, "BTC", "testnet")).to.be.true;

        fundedWallet = wClient.createWalletFromMnemonic(fundedMnemonic);
        expect(fundedWallet.address).to.eq(fundedAddress);
        expect(WAValidator.validate(fundedWallet.address, "BTC", "testnet")).to.be.true;

        const targetWallet = wClient.createWalletFromMnemonic(targetMnemonic);
        expect(targetWallet.address).to.eq(targetAddress);
        expect(WAValidator.validate(targetWallet.address, "BTC", "testnet")).to.be.true;
    });


    it("Should create transaction with custom fee", async () => {
        fundedWallet = wClient.createWalletFromMnemonic(fundedMnemonic);
        const [tr,] = await ServiceRepository.get(TransactionService).preparePaymentTransaction(0, fundedWallet.address, targetAddress, amountToSendSatoshi, feeInSatoshi, "Note");
        expect(typeof tr).to.equal("object");
    });

    it("Should not create transaction: fee > maxFee", async () => {
        fundedWallet = wClient.createWalletFromMnemonic(fundedMnemonic);
        const id = await wClient.createPaymentTransaction(fundedWallet.address, fundedWallet.privateKey, targetAddress, amountToSendSatoshi, feeInSatoshi, "Submit", maxFeeInSatoshi);
        expect(id).to.be.gt(0);

        const [txEnt] = await waitForTxToFinishWithStatus(2, 30, wClient.rootEm, TransactionStatus.TX_FAILED, id);
        expect(txEnt.maxFee!.lt(txEnt.fee!)).to.be.true;
    });

    it("Should receive fee", async () => {
        const fee = await wClient.getCurrentTransactionFee({
            source: fundedAddress,
            amount: amountToSendSatoshi,
            destination: targetAddress
        });
        expect(fee).not.to.be.null;
    });

    it.skip("Should prepare and execute transaction", async () => {
        fundedWallet = wClient.createWalletFromMnemonic(fundedMnemonic);
        const id = await wClient.createPaymentTransaction(fundedWallet.address, fundedWallet.privateKey, targetAddress, amountToSendSatoshi, undefined, note, undefined);
        expect(id).to.be.gt(0);
        const startTime = Date.now();
        const timeLimit = 600000; // 600 s
        for (let i = 0; ; i++) {
            const tx = await fetchTransactionEntityById(wClient.rootEm, id);
            if (tx.status == TransactionStatus.TX_SUCCESS) {
                break;
            }
            if (Date.now() - startTime > timeLimit) {
                console.log(tx)
                throw new Error(`Time limit exceeded for ${tx.id} with ${tx.transactionHash}`);
            }
            wClient.rootEm.clear();
            await sleepMs(2000);
        }
    });

    it("Should get fee for delete account", async () => {
        fundedWallet = wClient.createWalletFromMnemonic(fundedMnemonic);
        const [transaction,] = await ServiceRepository.get(TransactionService).preparePaymentTransaction(0, fundedWallet.address, targetAddress, null, undefined, "Note");
        expect(transaction.getFee()).to.be.gt(0);
    });

    it("Should get account balance", async () => {
        fundedWallet = wClient.createWalletFromMnemonic(fundedMnemonic);
        const accountBalance = await wClient.getAccountBalance(fundedWallet.address);
        expect(accountBalance.gt(new BN(0))).to.be.true;
    });

    it("Transaction with executeUntilBlock before current block height should fail", async () => {
        fundedWallet = wClient.createWalletFromMnemonic(fundedMnemonic);

        const currentBlock = await wClient.blockchainAPI.getCurrentBlockHeight();
        const id = await wClient.createPaymentTransaction(fundedWallet.address, fundedWallet.privateKey, targetAddress, amountToSendSatoshi, feeInSatoshi, "Submit", feeInSatoshi, currentBlock.number - 5);
        expect(id).to.be.gt(0);

        const [txEnt] = await waitForTxToFinishWithStatus(2, 40, wClient.rootEm, TransactionStatus.TX_FAILED, id);
        expect(txEnt.status).to.equal(TransactionStatus.TX_FAILED);
    });

    it("Transaction with executeUntilBlock too low should fail (executeUntilBlock - currentBlockHeight < executionBlockOffset)", async () => {
        fundedWallet = wClient.createWalletFromMnemonic(fundedMnemonic);

        const currentBlock = await wClient.blockchainAPI.getCurrentBlockHeight();
        const id = await wClient.createPaymentTransaction(fundedWallet.address, fundedWallet.privateKey, targetAddress, amountToSendSatoshi, feeInSatoshi, "Submit", feeInSatoshi, currentBlock.number + 1);
        expect(id).to.be.gt(0);

        const [txEnt] = await waitForTxToFinishWithStatus(2, 40, wClient.rootEm, TransactionStatus.TX_FAILED, id);
        expect(txEnt.status).to.equal(TransactionStatus.TX_FAILED);
    });

    it("Should submit TX_PREPARED that are in DB", async () => {
        fundedWallet = wClient.createWalletFromMnemonic(fundedMnemonic);

        const executeUntilBlock = (await wClient.blockchainAPI.getCurrentBlockHeight()).number + wClient.blockOffset;
        const txEnt = createTransactionEntity(wClient.rootEm, ChainType.testBTC, fundedWallet.address, targetAddress, amountToSendSatoshi, feeInSatoshi, note, undefined, executeUntilBlock);
        const [transaction] = await ServiceRepository.get(TransactionService).preparePaymentTransaction(txEnt.id, txEnt.source, txEnt.destination, txEnt.amount ?? null, txEnt.fee, note);
        txEnt.raw = Buffer.from(JSON.stringify(transaction));
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
        const txEnt = createTransactionEntity(wClient.rootEm, ChainType.testBTC, fundedWallet.address, targetAddress, amountToSendSatoshi, fee, note, undefined, executeUntilBlock);
        const [transaction] = await ServiceRepository.get(TransactionService).preparePaymentTransaction(txEnt.id, fundedWallet.address, targetAddress, amountToSendSatoshi, fee, note);
        const signed = await rewired.signTransaction(transaction, fundedWallet.privateKey);

        txEnt.raw = Buffer.from(JSON.stringify(transaction));
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
        const id = await wClient.createPaymentTransaction(fundedWallet.address, fundedWallet.privateKey, targetAddress, amountToSendSatoshi, feeInSatoshi, note, undefined);
        expect(id).to.be.gt(0);

        await waitForTxToFinishWithStatus(2, 15 * 60, wClient.rootEm, TransactionStatus.TX_SUCCESS, id);
    });

    it("Balance should change after transaction", async () => {
        fundedWallet = wClient.createWalletFromMnemonic(fundedMnemonic);

        const sourceBalanceStart = await wClient.getAccountBalance(fundedWallet.address);
        const targetBalanceStart = await wClient.getAccountBalance(targetAddress);

        const id = await wClient.createPaymentTransaction(fundedWallet.address, fundedWallet.privateKey, targetAddress, amountToSendSatoshi, feeInSatoshi, note, undefined);
        expect(id).to.be.gt(0);
        await waitForTxToFinishWithStatus(2, 15 * 60, wClient.rootEm, TransactionStatus.TX_SUCCESS, id);

        const sourceBalanceEnd = await wClient.getAccountBalance(fundedWallet.address);
        const targetBalanceEnd = await wClient.getAccountBalance(targetAddress);

        expect(sourceBalanceEnd.add(feeInSatoshi).add(amountToSendSatoshi).toNumber()).to.equal(sourceBalanceStart.toNumber());
        expect(targetBalanceStart.add(amountToSendSatoshi).toNumber()).to.be.equal(targetBalanceEnd.toNumber());
    });

    it("Transaction with execute until timestamp too low should fail", async () => {
        fundedWallet = wClient.createWalletFromMnemonic(fundedMnemonic);

        const id = await wClient.createPaymentTransaction(fundedWallet.address, fundedWallet.privateKey, targetAddress, amountToSendSatoshi, feeInSatoshi, "Submit", undefined, undefined, new Date().getTime() - 10);
        expect(id).to.be.gt(0);

        await waitForTxToFinishWithStatus(2, 30, wClient.rootEm, TransactionStatus.TX_FAILED, id);
    });

    it("Transaction with a too low fee should be updated with a higher fee", async () => {
        fundedWallet = wClient.createWalletFromMnemonic(fundedMnemonic);

        const startFee = toBNExp(0.0000000000001, 0);
        const id = await wClient.createPaymentTransaction(fundedWallet.address, fundedWallet.privateKey, targetAddress, amountToSendSatoshi, startFee, note, undefined);
        expect(id).to.be.gt(0);
        const [txEnt] = await waitForTxToFinishWithStatus(2, 15 * 60, wClient.rootEm, TransactionStatus.TX_SUCCESS, id);
        expect(txEnt.fee?.toNumber()).to.be.gt(startFee.toNumber());
    });

    it("Already spent UTXOs with wrong status should get a new status - consistency checker", async () => {
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

        const id = await wClient.createPaymentTransaction(fundedWallet.address, fundedWallet.privateKey, targetAddress, amountToSendSatoshi, undefined, note, undefined);
        expect(id).to.be.gt(0);
        await waitForTxToFinishWithStatus(0.1, 15 * 60, wClient.rootEm, TransactionStatus.TX_SUBMITTED, id);

        const [dbFee, calculatedFee] = await calculateNewFeeForTx(id, getDefaultFeePerKB(ChainType.testBTC), getCore((await setupRewiredWallet()).chainType), wClient.rootEm);
        expect(dbFee?.toNumber()).to.be.equal(calculatedFee);

        wClient.blockchainAPI.client.interceptors.request.eject(interceptorId);
        console.info();
    });

    it("If fee service is down the getCurrentFeeRate should be used", async () => {
        fundedWallet = wClient.createWalletFromMnemonic(fundedMnemonic);

        const fee = "0.05";
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
        const id = await wClient.createPaymentTransaction(fundedWallet.address, fundedWallet.privateKey, targetAddress, amountToSendSatoshi, undefined, note, undefined);
        expect(id).to.be.gt(0);

        await waitForTxToFinishWithStatus(2, 15 * 60, wClient.rootEm, TransactionStatus.TX_SUCCESS, id);
        const [dbFee, calculatedFee] = await calculateNewFeeForTx(id, feeRateInSatoshi, getCore((await setupRewiredWallet()).chainType), wClient.rootEm);
        expect(dbFee?.toNumber()).to.be.equal(calculatedFee);

        wClient.blockchainAPI.client.interceptors.request.eject(interceptorId);
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
            await waitForTxToFinishWithStatus(2, 15 * 60, wClient.rootEm, TransactionStatus.TX_SUCCESS, initialTxIds[i]);
        }
    });

    it("Should go to the fallback API", async () => {
        const bitcoreURL = "https://api.bitcore.io/api/DOGE/testnet/";
        wClient.blockchainAPI.clients[bitcoreURL] = new BitcoreAPI(createAxiosConfig(ChainType.testBTC, bitcoreURL), undefined);

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

    it("DB down after creating transaction", async () => {
        fundedWallet = wClient.createWalletFromMnemonic(fundedMnemonic);

        const id = await wClient.createPaymentTransaction(fundedWallet.address, fundedWallet.privateKey, targetAddress, amountToSendSatoshi);
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

        const id = await wClient.createPaymentTransaction(fundedWallet.address, fundedWallet.privateKey, targetAddress, amountToSendSatoshi);

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

        const stub = sinon.stub(utxoUtils, "hasTooHighOrLowFee");
        stub.returns(false);

        const id = await wClient.createPaymentTransaction(fundedWallet.address, fundedWallet.privateKey, targetAddress, amountToSendSatoshi.divn(5), feeInSatoshi.divn(10), note, undefined);
        expect(id).to.be.gt(0);

        // Wait for TX to be written into db and then reset the logic for fees
        await waitForTxToFinishWithStatus(0.005, 50, wClient.rootEm, [TransactionStatus.TX_PREPARED, TransactionStatus.TX_REPLACED, TransactionStatus.TX_SUBMITTED], id);
        stub.restore();

        await waitForTxToBeReplacedWithStatus(2, 15 * 60, wClient, TransactionStatus.TX_SUCCESS, id);
    });

    it.skip("Should prepare and execute transaction", async () => {
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

async function setupRewiredWallet() {
    const testOrm = await initializeTestMikroORM();
    const unprotectedDBWalletKeys = new UnprotectedDBWalletKeys(testOrm.em);
    BTCMccConnectionTest = {
        ...BTCMccConnectionTestInitial,
        api: blockchainAPI,
        em: testOrm.em,
        walletKeys: unprotectedDBWalletKeys,
        feeServiceConfig: feeServiceConfig,
    };
    const rewired = new rewiredUTXOWalletImplementationClass(BTCMccConnectionTestInitial);
    fundedWallet = rewired.createWalletFromMnemonic(fundedMnemonic);

    return rewired;
}
