const chai = require('chai');
chai.use(require('chai-as-promised'));
import { expect } from "chai";
import { WALLET } from "simple-wallet";
import { BlockChainHelper } from "../../../src/underlying-chain/BlockChainHelper";
import { MCC } from "@flarenetwork/mcc";

let blockChainHelper: BlockChainHelper;
let mccClient: MCC.ALGO;
let walletClient: WALLET.ALGO;

const ALGOWalletConnectionTest = {
    algod: {
        url: process.env.ALGO_ALGOD_URL_TESTNET_WALLET || "",
        token: ""
     },
};

const ALGOMccConnectionTest = {
    algod: {
        url: process.env.ALGO_ALGOD_URL_TESTNET_MCC || "",
        token: "",
    },
    indexer: {
        url: process.env.ALGO_INDEXER_URL_TESTNET_MCC || "",
        token: "",
    },
};

const txHash = "RGEUIORIOM6PTCP2EXZDKQRWPI6SJ4CBTH5LRYO7CLEQNYGIZS6A";
const blockId = 23614509;//24277222;
const fundedAddress = "T6WVPM7WLGP3DIBWNN3LJGCUNMFRR67BVV5KNS3VJ5HSEAQ3QKTGY5ZKWM";

describe("ALGO blockchain tests", async () => {

    before(async () => {
        walletClient = new WALLET.ALGO(ALGOWalletConnectionTest);
        mccClient = new MCC.ALGO(ALGOMccConnectionTest);
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
        await expect(blockChainHelper.getBlock("blockHash")).to.eventually.be.rejected; 
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
