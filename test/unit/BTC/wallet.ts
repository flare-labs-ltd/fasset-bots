import { PersistenceContext } from "../../../src/config/PersistenceContext";
import { DBWalletKeys } from "../../../src/underlying-chain/WalletKeys";
import { expect } from "chai";
import { WALLET } from "simple-wallet";
import { BlockChainWalletHelper } from "../../../src/underlying-chain/BlockChainWalletHelper";
import { BlockChainHelper } from "../../../src/underlying-chain/BlockChainHelper";
import { MCC } from "@flarenetwork/mcc";

let rootPc: PersistenceContext;
let pc: PersistenceContext;
let dbWallet: DBWalletKeys;
let walletHelper: BlockChainWalletHelper;
let blockChainHelper: BlockChainHelper;

let walletClient: WALLET.BTC;
let mccClient: MCC.BTC;

const fundedAddress = "mzM88w7CdxrFyzE8RKZmDmgYQgT5YPdA6S";
const fundedPrivateKey = "cNcsDiLQrYLi8rBERf9XPEQqVPHA7mUXHKWaTrvJVCTaNa68ZDqF";
const targetAddress = "mwLGdsLWvvGFapcFsx8mwxBUHfsmTecXe2";
const targetPrivateKey = "cTceSr6rvmAoQAXq617sk4smnzNUvAqkZdnfatfsjbSixBcJqDcY";

const BTCWalletConnectionTest = {
    url: process.env.BTC_LTC_DOGE_URL_WALLET || "",
    username: "",
    password: "",
    inTestnet: true
};

const BTCMCCConnectionTest = {
    url: process.env.BTC_URL_TESTNET_MCC || "",
    username: process.env.BTC_URL_USER_NAME_TESTNET_MCC || "",
    password: process.env.BTC_URL_PASSWORD_TESTNET_MCC || "",
    inTestnet: true
};

const amountToSendBTC = 0.00001;

describe("BTC wallet tests", async () => {

    before(async () => {
        rootPc = await PersistenceContext.create();
        pc = rootPc.clone();
        dbWallet = new DBWalletKeys(pc);
        walletClient = new WALLET.BTC(BTCWalletConnectionTest);
        mccClient = new MCC.BTC(BTCMCCConnectionTest);
        blockChainHelper = new BlockChainHelper(walletClient, mccClient);
        walletHelper = new BlockChainWalletHelper(walletClient, pc, blockChainHelper);
    })

    it("Should insert address and private key into db", async () => {
        await dbWallet.addKey(fundedAddress, fundedPrivateKey);
        await dbWallet.addKey(targetAddress, targetPrivateKey);
        const targetPrivateKeyFromDb = await dbWallet.getKey(targetAddress);
        const fundedPrivateKeyFromDb = await dbWallet.getKey(fundedAddress);
        expect(targetPrivateKeyFromDb).to.equal(targetPrivateKey);
        expect(fundedPrivateKeyFromDb).to.equal(fundedPrivateKey);
    });

    it.skip("Should send funds and retrieve transaction", async () => {
        const balanceBefore = await blockChainHelper.getBalance(targetAddress);
        const transaction = await walletHelper.addTransaction(fundedAddress, targetAddress, amountToSendBTC, "TestNote", undefined, true);
        const balanceAfter = await blockChainHelper.getBalance(targetAddress);
        const retrievedTransaction = await blockChainHelper.getTransaction(transaction);
        expect(transaction).to.equal(retrievedTransaction?.hash);
        expect(balanceAfter.toNumber()).to.be.greaterThan(balanceBefore.toNumber());
    });

});
