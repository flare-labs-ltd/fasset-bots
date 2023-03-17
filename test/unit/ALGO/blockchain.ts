import chaiAsPromised from "chai-as-promised";
import { expect, use } from "chai";
use(chaiAsPromised);
import { createBlockChainHelper } from "../../../src/config/BotConfig";
import { BlockChainHelper } from "../../../src/underlying-chain/BlockChainHelper";
import { SourceId } from "../../../src/verification/sources/sources";

let blockChainHelper: BlockChainHelper;
const sourceId: SourceId = SourceId.ALGO;

const txHash0 = "RGEUIORIOM6PTCP2EXZDKQRWPI6SJ4CBTH5LRYO7CLEQNYGIZS6A";
const blockId1 = 23614509;

describe("ALGO blockchain tests", async () => {

    before(async () => {
        blockChainHelper = createBlockChainHelper(sourceId);
    })

    it("Should retrieve transaction", async () => {
        const retrievedTransaction = await blockChainHelper.getTransaction(txHash0);
        expect(txHash0).to.be.eq(retrievedTransaction?.hash);
    });

    it("Should retrieve balance", async () => {
        await expect(blockChainHelper.getBalance()).to.eventually.be.rejectedWith("Method not implemented on chain. Use wallet.").and.be.an.instanceOf(Error);
    });

    it("Should not retrieve block (hash) - not implemented", async () => {
        await expect(blockChainHelper.getBlock("blockHash")).to.eventually.be.rejectedWith("Method not implemented in ALGO.").and.be.an.instanceOf(Error);
    });

    it("Should retrieve block (number)", async () => {
        const retrievedBlock = await blockChainHelper.getBlockAt(blockId1);
        expect(blockId1).to.be.eq(retrievedBlock?.number);
    });

    it("Should retrieve block height", async () => {
        const retrievedHeight = await blockChainHelper.getBlockHeight();
        expect(retrievedHeight).to.be.greaterThanOrEqual(blockId1);
    });

    it("Should retrieve transaction block", async () => {
        await expect(blockChainHelper.getTransactionBlock()).to.eventually.be.rejectedWith("Method not implemented on chain. Use indexer.").and.be.an.instanceOf(Error);
    });

    it("Should retrieve transaction fee", async () => {
        await expect(blockChainHelper.getBlock("blockHash")).to.eventually.be.rejectedWith("Method not implemented in ALGO.").and.be.an.instanceOf(Error);
    });

    it("Should not retrieve invalid transaction", async () => {
        const invalidTxHash = txHash0.slice(0,36);
        const retrievedTransaction = await blockChainHelper.getTransaction(invalidTxHash);
        expect(retrievedTransaction).to.be.null;
    });

    it("Should not retrieve block with invalid number", async () => {
        const blockHeight = await blockChainHelper.getBlockHeight();
        const invalidBlockNumber = blockHeight * 100;
        const retrievedBlock = await blockChainHelper.getBlockAt(invalidBlockNumber);
        expect(retrievedBlock).to.be.null;
    });

});
