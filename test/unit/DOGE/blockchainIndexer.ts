import { MCC } from "@flarenetwork/mcc";
import { expect } from "chai";
import { WALLET } from "simple-wallet";
import { BlockChainIndexerHelper } from "../../../src/underlying-chain/BlockChainIndexerHelper";
import { requireEnv } from "../../../src/utils/helpers";
import { SourceId } from "../../../src/verification/sources/sources";

let blockChainIndexerClient: BlockChainIndexerHelper;
const indexerWebServerUrl: string = requireEnv('INDEXER_WEB_SERVER_URL');
const sourceId: SourceId = SourceId.DOGE;
let walletClient: WALLET.DOGE;
let mccClient: MCC.DOGE;

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

const txHash = "94a678dad4ccc05375f28c5e7bb6e8c02573a552898f50480d6af8548e731e75";
const blockId = 4074766;
const blockHash = "e8ee3ff71df4338b7864e99afee8123c5993aa8eafe2af152bb7c91444586c98";
const fundedAddress = "nou7f8j829FAEb4SzLz3F1N1CrMAy58ohw";

describe("DOGE blockchain tests via indexer", async () => {

    before(async () => {
        walletClient = new WALLET.DOGE(DOGEWalletConnectionTest);
        mccClient = new MCC.DOGE(DOGEMccConnectionTest);
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
