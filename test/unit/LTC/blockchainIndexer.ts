import { expect } from "chai";
import { createBlockChainIndexerHelper } from "../../../src/config/BotConfig";
import { BlockChainIndexerHelper } from "../../../src/underlying-chain/BlockChainIndexerHelper";
import { SourceId } from "../../../src/verification/sources/sources";

let blockChainIndexerClient: BlockChainIndexerHelper;
const sourceId: SourceId = SourceId.LTC;

const txHash = "9faaf0891133ecf6254976fe3dac5d2480b218f030a46a6380f2764c4b95fdfa";
const blockId = 2559164;
const blockHash = "308df85e795716573b71379c30bbeb5f7fb78f4f15fdea1bfe8053439ade32ed";

describe.skip("LTC blockchain tests via indexer", async () => {

    before(async () => {
        //TODO no indexer yet
        blockChainIndexerClient = createBlockChainIndexerHelper("", sourceId, true, "");
    })

    it("Should retrieve transaction", async () => {
        const retrievedTransaction = await blockChainIndexerClient.getTransaction(txHash);
        expect(txHash).to.be.eq(retrievedTransaction?.hash);
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
