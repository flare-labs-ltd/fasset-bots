import { expect } from "chai";
import { WALLET } from "simple-wallet";
import { BlockChainHelper } from "../../../src/underlying-chain/BlockChainHelper";
import { MCC } from "@flarenetwork/mcc";

let blockChainHelper: BlockChainHelper;
let mccClient: MCC.XRP;
let walletClient: WALLET.XRP;

const XRPWalletConnectionTest = {
    url: process.env.XRP_URL_TESTNET_WALLET || "",
    username: "",
    password: "",
    inTestnet: true
};

const XRPMccConnectionTest = {
    url: process.env.XRP_URL_TESTNET_MCC || "",
    username: "",
    password: "",
    inTestnet: true
};

const txHash = "6C43D0F27F98B03979DC8869AAABDAD6B3C4E023580A2B25349C7FF5C1A52BEB";
const blockId = 31387252;
const blockHash = "53C070D1842C17A9A4A3980CC5168BCA7A8486440219E6A430717911BF10099D";
const fundedAddress = "rpZ1bX5RqATDiB7iskGLmspKLrPbg5X3y8";

describe("XRP blockchain tests", async () => {

    before(async () => {
        walletClient = new WALLET.XRP(XRPWalletConnectionTest);
        mccClient = new MCC.XRP(XRPMccConnectionTest);
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
