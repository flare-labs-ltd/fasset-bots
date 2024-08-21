import {WALLET} from "../../src";
import {
    BitcoinWalletConfig,
    FeeServiceConfig,
    ICreateWalletResponse
} from "../../src/interfaces/IWalletTransaction";
import chaiAsPromised from "chai-as-promised";
import {expect, use} from "chai";

use(chaiAsPromised);
import WAValidator from "wallet-address-validator";
import {toBN} from "../../src/utils/bnutils";
import rewire from "rewire";
import {fetchTransactionEntityById, fetchMonitoringState} from "../../src/db/dbutils";
import {sleepMs} from "../../src/utils/utils";
import {TransactionStatus} from "../../src/entity/transaction";
import {initializeTestMikroORM} from "../test-orm/mikro-orm.config";
import {UnprotectedDBWalletKeys} from "../test-orm/UnprotectedDBWalletKey";
import {
    addConsoleTransportForTests,
    loop,
    resetMonitoringOnForceExit,
    setMonitoringStatus,
    waitForTxToFinishWithStatus
} from "../test_util/util";
import {logger} from "../../src/utils/logger";
import BN from "bn.js";

const rewiredUTXOWalletImplementation = rewire("../../src/chain-clients/BtcWalletImplementation");
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

let wClient: WALLET.BTC;
let fundedWallet: ICreateWalletResponse;
let targetWallet: ICreateWalletResponse;

describe("Bitcoin wallet tests", () => {
    let removeConsoleLogging: () => void;

    before(async () => {
        removeConsoleLogging = addConsoleTransportForTests(logger);

        const testOrm = await initializeTestMikroORM();
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
        const rewired = new rewiredUTXOWalletImplementationClass(BTCMccConnectionTest);
        rewired.orm = await initializeTestMikroORM();
        fundedWallet = rewired.createWalletFromMnemonic(fundedMnemonic);
        const tr = await rewired.preparePaymentTransaction(fundedWallet.address, targetAddress, amountToSendSatoshi, feeInSatoshi, "Note");
        expect(typeof tr).to.equal("object");
    });

    it("Should not create transaction: fee > maxFee", async () => {
        const rewired = new rewiredUTXOWalletImplementationClass(BTCMccConnectionTest);
        rewired.orm = await initializeTestMikroORM();
        fundedWallet = rewired.createWalletFromMnemonic(fundedMnemonic);
        await expect(rewired.preparePaymentTransaction(fundedWallet.address, targetAddress, amountToSendSatoshi, feeInSatoshi, "Note", maxFeeInSatoshi)).to.eventually
            .be.rejectedWith(`Transaction preparation failed due to fee restriction (fee: ${feeInSatoshi.toString()}, maxFee: ${maxFeeInSatoshi.toString()})`);
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
        const note = "10000000000000000000000000000000000000000beefbeaddeafdeaddeedcac";
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
        const rewired = new rewiredUTXOWalletImplementationClass(BTCMccConnectionTest);
        rewired.orm = await initializeTestMikroORM();
        await rewired.feeService?.setupHistory();
        void rewired.feeService?.startMonitoringFees();

        fundedWallet = rewired.createWalletFromMnemonic(fundedMnemonic);
        const transaction = await rewired.preparePaymentTransaction(fundedWallet.address, targetAddress, null, null, "Note", maxFeeInSatoshi);

        expect(transaction.getFee()).to.be.gt(0);
    });

    it("Should get account balance", async () => {
        fundedWallet = wClient.createWalletFromMnemonic(fundedMnemonic);
        const accountBalance = await wClient.getAccountBalance(fundedWallet.address);
        expect(accountBalance.gt(new BN(0))).to.be.true;
    });

    it.skip("Stress test", async () => {
        fundedWallet = wClient.createWalletFromMnemonic(fundedMnemonic);
        targetWallet = wClient.createWalletFromMnemonic(targetMnemonic);

        const N_TRANSACTIONS = 15;

        const ids = []
        for (let i = 0; i < N_TRANSACTIONS; i++) {
            // let id;
            // if (Math.random() > 0.5) {
            const id = await wClient.createPaymentTransaction(fundedWallet.address, fundedWallet.privateKey, targetAddress, amountToSendSatoshi, feeInSatoshi.muln(2));
            // }
            // else {
            //     id = await wClient.createPaymentTransaction(targetWallet.address, targetWallet.privateKey, fundedWallet.address, amountToSendSatoshi, feeInSatoshi);
            // }
            ids.push(id);
        }

        while (1) {
            await sleepMs(2000);
        }
    });

    it("Transaction with a too low fee should be updated with a higher fee", async () => {
        fundedWallet = wClient.createWalletFromMnemonic(fundedMnemonic);
        const startFee = new BN(0.0000000001);
        const id = await wClient.createPaymentTransaction(fundedWallet.address, fundedWallet.privateKey, targetAddress, amountToSendSatoshi, startFee);
        expect(id).to.be.gt(0);
        const [txEnt, ] = await waitForTxToFinishWithStatus(2, 15 * 60, wClient.rootEm, TransactionStatus.TX_SUCCESS, id);
        expect(txEnt.fee?.toNumber()).to.be.gt(startFee.toNumber());
    });

    //TODO
    // it.skip("Should prepare and execute transaction", async () => {
    //    fundedWallet = wClient.createWalletFromMnemonic(fundedMnemonic);
    //    const note = "dead0000000000000000000000000000000000000beefbeaddeafdeaddeedcab";
    //    const submit = await wClient.deleteAccount(fundedWallet.address, fundedWallet.privateKey, targetAddress, undefined, note);
    //    expect(typeof submit).to.equal("object");
    // });
});
