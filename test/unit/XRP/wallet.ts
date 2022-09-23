import { PersistenceContext } from "../../../src/config/PersistenceContext";
import { DBWalletKeys } from "../../../src/underlying-chain/WalletKeys";
import { expect } from "chai";
import { WALLET } from "simple-wallet/src";
import { BlockChainWalletHelper } from "../../../src/underlying-chain/BlockChainWalletHelper";
import { BlockChainHelper } from "../../../src/underlying-chain/BlockChainHelper";
import { MCC } from "@flarenetwork/mcc/src";

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

const amountToSendXRP = 10;

describe("XRP wallet tests", async () => {

    before(async () => {
        rootPc = await PersistenceContext.create();
        pc = rootPc.clone();
        dbWallet = new DBWalletKeys(pc);
        walletClient = new WALLET.XRP(XRPMccConnectionTest);
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
        const balanceBefore = await blockChainHelper.getBalance(targetAddress);
        const transaction = await walletHelper.addTransaction(fundedAddress, targetAddress, amountToSendXRP, "TestNote", undefined, true);
        const balanceAfter = await blockChainHelper.getBalance(targetAddress);
        const retrievedTransaction = await blockChainHelper.getTransaction(transaction);
        expect(transaction).to.equal(retrievedTransaction?.hash);
        expect(balanceAfter.toNumber()).to.be.greaterThan(balanceBefore.toNumber());
    });

});
