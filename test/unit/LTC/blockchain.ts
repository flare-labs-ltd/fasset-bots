import { expect } from "chai";
import { WALLET } from "simple-wallet";
import { BlockChainHelper } from "../../../src/underlying-chain/BlockChainHelper";
import { MCC } from "@flarenetwork/mcc";

let blockChainHelper: BlockChainHelper;
let mccClient: MCC.LTC;
let walletClient: WALLET.LTC;

const LTCWalletConnectionTest = {
    url: process.env.BTC_LTC_DOGE_URL_WALLET || "",
    username: "",
    password: ""
};

const LTCMccConnectionTest = {
    url: process.env.LTC_URL_TESTNET_MCC || "",
    username: process.env.LTC_USERNAME_TESTNET_MCC || "",
    password: process.env.LTC_PASSWORD_TESTNET_MCC || "",
    inTestnet: true
};

const txHash = "28872e7d2268343c96d80c56962c9650a6796119835136be9f002215f438dca6";
const blockId = 2538180;
const blockHash = "257edc6d99359f37ca84fb5edabd9c4651f5db852555243ac48fbedfcc3aecf6";
const fundedAddress = "mzM88w7CdxrFyzE8RKZmDmgYQgT5YPdA6S";

describe("LTC blockchain tests", async () => {

    before(async () => {
        walletClient = new WALLET.LTC(LTCWalletConnectionTest);
        mccClient = new MCC.LTC(LTCMccConnectionTest);
        blockChainHelper = new BlockChainHelper(walletClient, mccClient);
    })

    it("Should retrieve transaction", async () => {
        const retrievedTransaction = await blockChainHelper.getTransaction(txHash);
        expect(txHash).to.be.eq(retrievedTransaction?.hash);
    });

    it("Should retrieve balance", async () => {
        const balance = await blockChainHelper.getBalance(fundedAddress);
        expect(balance.toNumber()).to.be.greaterThanOrEqual(0);
    });

    it("Should retrieve block (hash)", async () => {
        const retrievedBlock = await blockChainHelper.getBlock(blockHash);
        expect(blockId).to.be.eq(retrievedBlock?.number);
    });

    it("Should retrieve block (number)", async () => {
        const retrievedBlock = await blockChainHelper.getBlockAt(blockId);
        expect(blockId).to.be.eq(retrievedBlock?.number);
    });

    it("Should retrieve block height", async () => {
        const retrievedHeight = await blockChainHelper.getBlockHeight();
        expect(retrievedHeight).to.be.greaterThanOrEqual(blockId);
    });

    it("Should retrieve transaction block", async () => {
        const transactionBlock = await blockChainHelper.getTransactionBlock(txHash);
        expect(transactionBlock?.number).to.be.eq(blockId);
        expect(transactionBlock?.hash).to.be.eq(blockHash);
    });

});
