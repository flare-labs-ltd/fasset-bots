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

const txHash = "a8427e200fa1074bb6b5696560b3a764c8fbcea1af3ded526766f5c696fdecf5";
const blockId = 2378222;
const blockHash = "000000000000001db67a27cca93221398c1948e65bcdf65a26004619f5e9e810";
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
