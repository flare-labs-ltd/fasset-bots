import { createBlockChainIndexerHelper } from "../../../src/config/BotConfig";
import { BlockChainIndexerHelper } from "../../../src/underlying-chain/BlockChainIndexerHelper";
import { SourceId } from "../../../src/verification/sources/sources";
import chaiAsPromised from "chai-as-promised";
import { expect, use } from "chai";
use(chaiAsPromised);


const sourceId: SourceId = SourceId.DOGE;
const txHash = "e882fe50c107b4528593191fd6f9985041e32ba7de118007c1a6f0a5af20efb9";
const blockId = 4864015;
const blockHash = "1fcc47db0722c51c2cf42ceeffc9468004db76ab9082ca06f7ea7e1497761ba6";

describe.skip("DOGE blockchain tests via indexer", async () => {
    let blockChainIndexerClient: BlockChainIndexerHelper;

    before(async () => {
        blockChainIndexerClient = createBlockChainIndexerHelper(sourceId);
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
