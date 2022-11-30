const chai = require('chai');
chai.use(require('chai-as-promised'));
import { expect } from "chai";
import { BlockChainIndexerHelper } from "../../../src/underlying-chain/BlockChainIndexerHelper";
import { SourceId } from "../../../src/verification/sources/sources";
import { createTestIndexerHelper } from "../../utils/test-bot-config";

let blockChainIndexerClient: BlockChainIndexerHelper;
const sourceId: SourceId = SourceId.ALGO;

const txHash = "2117898bd891d3191b616492e027999052e35dc0e023131adfb296412986e7bc";
const blockId = 24044383;
const blockHash = "648764971e7918177935ab1689f0e62a348df4c156060eabd054b787dcc7e79d";
const fundedAddress = "T6WVPM7WLGP3DIBWNN3LJGCUNMFRR67BVV5KNS3VJ5HSEAQ3QKTGY5ZKWM";

describe("ALGO blockchain tests via indexer", async () => {

    before(async () => {
        blockChainIndexerClient = createTestIndexerHelper(sourceId);
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
        expect(blockHash).to.be.eq(retrievedBlock?.hash);
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

