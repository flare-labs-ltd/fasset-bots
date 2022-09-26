import { expect } from "chai";
import { WALLET } from "simple-wallet";
import { BlockChainHelper } from "../../../src/underlying-chain/BlockChainHelper";
import { MCC } from "@flarenetwork/mcc";

let blockChainHelper: BlockChainHelper;
let mccClient: MCC.BTC;
let walletClient: WALLET.BTC;

const BTCWalletConnectionTest = {
    url: process.env.BTC_LTC_DOGE_URL_WALLET || "",
    username: "",
    password: ""
};

const BTCMccConnectionTest = {
    url: process.env.BTC_URL_TESTNET_MCC || "",
    username: process.env.BTC_USERNAME_TESTNET_MCC || "",
    password: process.env.BTC_PASSWORD_TESTNET_MCC || "",
    inTestnet: true
};

const txHash = "c545084a28520ac62dc113b951e981b11dd57b23122a5e814c34fb9e15b23890";
const blockId = 2347669;
const blockHash = "000000000000000f68dec9af25075839c9a010d8631c675f5841fb71145c92a5";
const fundedAddress = "mzM88w7CdxrFyzE8RKZmDmgYQgT5YPdA6S";

describe("BTC blockchain tests", async () => {

    before(async () => {
        walletClient = new WALLET.BTC(BTCWalletConnectionTest);
        mccClient = new MCC.BTC(BTCMccConnectionTest);
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

});
