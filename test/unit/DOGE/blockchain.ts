import { expect } from "chai";
import { WALLET } from "simple-wallet/src";
import { BlockChainHelper } from "../../../src/underlying-chain/BlockChainHelper";
import { MCC } from "@flarenetwork/mcc/src";

let blockChainHelper: BlockChainHelper;
let mccClient: MCC.DOGE;
let walletClient: WALLET.DOGE;

const DOGEWalletConnectionTest = {
    url: process.env.BTC_LTC_DOGE_URL_WALLET || "",
    username: "",
    password: ""
};

const DOGEMccConnectionTest = {
    url: process.env.DOGE_URL_TESTNET_MCC || "",
    username: process.env.DOGE_USERNAME_TESTNET_MCC || "",
    password: process.env.DOGE_PASSWORD_TESTNET_MCC || "",
    inTestnet: true
};

const txHash = "8d0609d85fa234b77ccdfd5494227fc3f620e9a4c9d84e164981e70a8d7c8bc6";
const blockId = 4042116;
const blockHash = "53eb2016bb56d31874683df9f5956041cbcccd3a7c7138608bce81b7dfad317e";
const fundedAddress = "nou7f8j829FAEb4SzLz3F1N1CrMAy58ohw";

describe("DOGE blockchain tests", async () => {

    before(async () => {
        walletClient = new WALLET.DOGE(DOGEWalletConnectionTest);
        mccClient = new MCC.DOGE(DOGEMccConnectionTest);
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
