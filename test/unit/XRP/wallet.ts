import { PersistenceContext } from "../../../src/config/PersistenceContext";
import { DBWalletKeys } from "../../../src/underlying-chain/WalletKeys";
import { expect } from "chai";
import { WALLET } from "simple-wallet";
import { BlockChainWalletHelper } from "../../../src/underlying-chain/BlockChainWalletHelper";
import { BlockChainHelper } from "../../../src/underlying-chain/BlockChainHelper";
import { MCC } from "@flarenetwork/mcc";
const chai = require('chai');
chai.use(require('chai-as-promised'));

let rootPc: PersistenceContext;
let pc: PersistenceContext;
let dbWallet: DBWalletKeys;
let walletHelper: BlockChainWalletHelper;
let blockChainHelper: BlockChainHelper;

let walletClient: WALLET.XRP;
let mccClient: MCC.XRP;

const fundedAddress = "rpZ1bX5RqATDiB7iskGLmspKLrPbg5X3y8";
const fundedPrivateKey = "0058C2435FB3951ACC29F4D7396632713063F9DB3C49B320167F193CDA0E3A1622";
const targetAddress = "r4CrUeY9zcd4TpndxU5Qw9pVXfobAXFWqq";
const targetPrivateKey = "00AF22D6EB35EFFC065BC7DBA21068DB400F1EC127A3F4A3744B676092AAF04187";

const XRPMccConnectionTest = {
    url: process.env.XRP_URL_TESTNET_MCC || "",
    username: "",
    password: "",
    inTestnet: true
};
const XRPWalletConnectionTest = {
    url: process.env.XRP_URL_TESTNET_WALLET || "",
    username: "",
    password: "",
    inTestnet: true
};

const amountToSendXRP = 10;

describe("XRP wallet tests", async () => {

    before(async () => {
        rootPc = await PersistenceContext.create();
        pc = rootPc.clone();
        dbWallet = new DBWalletKeys(pc);
        walletClient = new WALLET.XRP(XRPWalletConnectionTest);
        mccClient = new MCC.XRP(XRPMccConnectionTest);
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
        const note = "10000000000000000000000000000000000000000beefbeaddeafdeaddeedcab";
        const balanceBefore = await blockChainHelper.getBalance(targetAddress);
        const options = { maxFee: 12 }; // maxFee in Drops
        const transaction = await walletHelper.addTransaction(fundedAddress, targetAddress, amountToSendXRP, note, options, true);
        const balanceAfter = await blockChainHelper.getBalance(targetAddress);
        const retrievedTransaction = await blockChainHelper.getTransaction(transaction);
        expect(transaction).to.equal(retrievedTransaction?.hash);
        expect(balanceAfter.toNumber()).to.be.greaterThan(balanceBefore.toNumber());
    });

    it("Should not send funds: fee > maxFee", async () => {
        const note = "10000000000000000000000000000000000000000beefbeaddeafdeaddeedcab";
        const options = { maxFee: 8 }; // maxFee in Drops
        await expect(walletHelper.addTransaction(fundedAddress, targetAddress, amountToSendXRP, note, options, true)).to.eventually.be.rejected; 
    });

});
