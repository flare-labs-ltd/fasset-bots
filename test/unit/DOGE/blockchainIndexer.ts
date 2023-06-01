import { createBlockChainIndexerHelper } from "../../../src/config/BotConfig";
import { BlockChainIndexerHelper } from "../../../src/underlying-chain/BlockChainIndexerHelper";
import { SourceId } from "../../../src/verification/sources/sources";
import { requireEnv } from "../../../src/utils/helpers";
import chaiAsPromised from "chai-as-promised";
import { expect, use } from "chai";
use(chaiAsPromised);


const sourceId: SourceId = SourceId.DOGE;
const txHash = "bae6bf82646bda1b713fa64d81c691a5893b951724c9afdfa51ea636d4b4ed3c";
const blockId = 4799617;
const blockHash = "f9cb0022e8cac36970ae1d6cf13494ca0c4e6246efbd8b04f0b3132fccdd1c1c";

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
