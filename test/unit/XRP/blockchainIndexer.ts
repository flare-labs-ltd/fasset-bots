import { expect } from "chai";
import { BlockChainIndexerHelper } from "../../../src/underlying-chain/BlockChainIndexerHelper";
import { SourceId } from "../../../src/verification/sources/sources";
import { createTestIndexerHelper } from "../../utils/test-bot-config";

let blockChainIndexerClient: BlockChainIndexerHelper;
const sourceId: SourceId = SourceId.XRP;

const txHash = "B13959D20BFF1AC0A7CE6A82CACD755DAC7718FFD77AD360BA35BCCBD975E94C";
const blockId = 31788287;
const blockHash = "81E91F148AA08FF8EBD6A088A1CE0BE55A66B001BE94C4CAEE86FA87927AA205";
const fundedAddress = "rpZ1bX5RqATDiB7iskGLmspKLrPbg5X3y8";

describe("XRP blockchain tests via indexer", async () => {

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