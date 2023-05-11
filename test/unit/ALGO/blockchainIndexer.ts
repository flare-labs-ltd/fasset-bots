import chaiAsPromised from "chai-as-promised";
import { expect, use } from "chai";
use(chaiAsPromised);
import { createBlockChainIndexerHelper } from "../../../src/config/BotConfig";
import { BlockChainIndexerHelper } from "../../../src/underlying-chain/BlockChainIndexerHelper";
import { SourceId } from "../../../src/verification/sources/sources";
import rewire from "rewire";
const rewiredBlockChainIndexerHelper = rewire("../../../src/underlying-chain/BlockChainIndexerHelper");
const rewiredBlockChainIndexerHelperClass = rewiredBlockChainIndexerHelper.__get__("BlockChainIndexerHelper");

const sourceId: SourceId = SourceId.ALGO;
const txHash = "ae4491a8a57f45555d467a79c8a9ac70411ca0f6d2d4ce729e957a39b9c36638";
const blockId = 24078316;
const blockHash = "c6e59c61584b193701a0b880a6575bed9e8e434f33da8493a4eb1ff6d27fc064";

describe.skip("ALGO blockchain tests via indexer", async () => {
    //TODO - no indexer yet
    let rewiredBlockChainIndexerClient: typeof rewiredBlockChainIndexerHelperClass;
    let blockChainIndexerClient: BlockChainIndexerHelper;

    before(async () => {
        rewiredBlockChainIndexerClient = new rewiredBlockChainIndexerHelperClass("", sourceId, "");
        blockChainIndexerClient = createBlockChainIndexerHelper("", sourceId, "");
    })

    it("Should retrieve transaction", async () => {
        const retrievedTransaction = await blockChainIndexerClient.getTransaction(txHash);
        expect(txHash).to.be.eq(retrievedTransaction?.hash);
    });

    it("Should not retrieve balance - not implemented", async () => {
        await expect(blockChainIndexerClient.getBalance()).to.eventually.be.rejectedWith("Method not implemented on indexer. Use wallet.").and.be.an.instanceOf(Error);
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

