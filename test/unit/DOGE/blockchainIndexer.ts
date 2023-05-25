import { createBlockChainIndexerHelper } from "../../../src/config/BotConfig";
import { BlockChainIndexerHelper } from "../../../src/underlying-chain/BlockChainIndexerHelper";
import { SourceId } from "../../../src/verification/sources/sources";
import { requireEnv } from "../../../src/utils/helpers";
import chaiAsPromised from "chai-as-promised";
import { expect, use } from "chai";
use(chaiAsPromised);


const sourceId: SourceId = SourceId.DOGE;
const txHash = "f2689b2f34c9acf7f6bc765863321972517c2e96cdb4aadc04834ecab799e5dd";
const blockId = 4752697;
const blockHash = "b6e913e223ab8d4296ee4807f5e915cdbedf034fb20da48a34fd346312dd6a95";

describe("DOGE blockchain tests via indexer", async () => {
    let blockChainIndexerClient: BlockChainIndexerHelper;

    before(async () => {
        blockChainIndexerClient = createBlockChainIndexerHelper(requireEnv("INDEXER_DOGE_WEB_SERVER_URL"), sourceId, requireEnv("INDEXER_DOGE_API_KEY"));
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
