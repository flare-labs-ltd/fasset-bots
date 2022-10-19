import { MCC } from "@flarenetwork/mcc";
import { expect } from "chai";
import { BlockChainWalletHelper } from "../../../src/underlying-chain/BlockChainWalletHelper";
import { WALLET } from "simple-wallet";
import { PersistenceContext } from "../../../src/config/PersistenceContext";
import { BlockChainHelper } from "../../../src/underlying-chain/BlockChainHelper";
import { DBWalletKeys } from "../../../src/underlying-chain/WalletKeys";

let rootPc: PersistenceContext;
let pc: PersistenceContext;
let dbWallet: DBWalletKeys;
let walletHelper: BlockChainWalletHelper;
let blockChainHelper: BlockChainHelper;

let walletClient: WALLET.DOGE;
let mccClient: MCC.DOGE;

const fundedAddress = "nou7f8j829FAEb4SzLz3F1N1CrMAy58ohw";
const fundedPrivateKey = "cfHf9MCiZbPidE1XXxCCBnzwJSKRtvpfoZrY6wFvy17HmKbBqt1j";
const targetAddress = "nk1Uc5w6MHC1DgtRvnoQvCj3YgPemzha7D";
const targetPrivateKey = "ckmubApfH515MCZNC9ufLR4kHrmnb1PCtX2vhoN4iYx9Wqzh2AQ9";

const DOGEWalletConnectionTest = {
    url: process.env.BTC_LTC_DOGE_URL_WALLET || "",
    username: "",
    password: "",
    inTestnet: true
};

const DOGEMccConnectionTest = {
    url: process.env.DOGE_URL_TESTNET_MCC || "",
    username: process.env.DOGE_USERNAME_TESTNET_MCC || "",
    password: process.env.DOGE_PASSWORD_TESTNET_MCC || "",
    inTestnet: true
};

const amountToSendDOGE = 1;

describe("DOGE wallet tests", async () => {

    before(async () => {
        rootPc = await PersistenceContext.create();
        pc = rootPc.clone();
        dbWallet = new DBWalletKeys(pc);
        walletClient = new WALLET.DOGE(DOGEWalletConnectionTest);
        mccClient = new MCC.DOGE(DOGEMccConnectionTest);
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

    it("Should send funds and retrieve transaction", async () => {
        const balanceBefore = await blockChainHelper.getBalance(targetAddress);
        const transaction = await walletHelper.addTransaction(fundedAddress, targetAddress, amountToSendDOGE, "TestNote", undefined, true);
        const balanceAfter = await blockChainHelper.getBalance(targetAddress);
        const retrievedTransaction = await blockChainHelper.getTransaction(transaction);
        expect(transaction).to.equal(retrievedTransaction?.hash);
        expect(balanceAfter.toNumber()).to.be.greaterThan(balanceBefore.toNumber());
    });

});
