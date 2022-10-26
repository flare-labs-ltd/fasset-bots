import { MCC } from "@flarenetwork/mcc";
import { expect } from "chai";
import { WALLET } from "simple-wallet";
import { BlockChainIndexerHelper } from "../../../src/underlying-chain/BlockChainIndexerHelper";
import { requireEnv } from "../../../src/utils/helpers";
import { SourceId } from "../../../src/verification/sources/sources";

let blockChainIndexerClient: BlockChainIndexerHelper;
const indexerWebServerUrl: string = requireEnv('INDEXER_WEB_SERVER_URL');
const sourceId: SourceId = SourceId.BTC;
let walletClient: WALLET.BTC;
let mccClient: MCC.BTC;

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

const txHash = "686161d6e320c1d3237116b1204e7bba0f017e098e7e20eccacc6f3378523d93";
const blockId = 2378092;
const blockHash = "0000000000000020e04485e7ac9f61aaea2dbe51fd64154eec2f8f7d68cf176a";
const fundedAddress = "mzM88w7CdxrFyzE8RKZmDmgYQgT5YPdA6S";

describe("BTC blockchain tests via indexer", async () => {

    before(async () => {
        walletClient = new WALLET.BTC(BTCWalletConnectionTest);
        mccClient = new MCC.BTC(BTCMccConnectionTest);
        blockChainIndexerClient = new BlockChainIndexerHelper(indexerWebServerUrl, sourceId, walletClient, mccClient);
    })

    it("Should retrieve transaction", async () => {
        const retrievedTransaction = await blockChainIndexerClient.getTransaction(txHash);
        expect(txHash).to.be.eq(retrievedTransaction?.hash);
    });

    it("Should retrieve balance", async () => {
        const balance = await blockChainIndexerClient.getBalance(fundedAddress);
        expect(balance.toNumber()).to.be.greaterThanOrEqual(0);
    });

    it("Should retrieve block (hash)", async () => {
        const retrievedBlock = await blockChainIndexerClient.getBlock(blockHash);
        expect(blockId).to.be.eq(retrievedBlock?.number);
    });

    it("Should retrieve block (number)", async () => {
        const retrievedBlock = await blockChainIndexerClient.getBlockAt(blockId);
        expect(blockId).to.be.eq(retrievedBlock?.number);
    });

    it("Should retrieve block height", async () => {
        const retrievedHeight = await blockChainIndexerClient.getBlockHeight();
        expect(retrievedHeight).to.be.greaterThanOrEqual(blockId);
    });

    it("Should retrieve transaction block", async () => {
        const transactionBlock = await blockChainIndexerClient.getTransactionBlock(txHash);
        expect(transactionBlock?.number).to.be.eq(blockId);
        expect(transactionBlock?.hash).to.be.eq(blockHash);
    });

});
