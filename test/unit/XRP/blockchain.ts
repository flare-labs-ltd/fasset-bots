import chaiAsPromised from "chai-as-promised";
import { expect, use } from "chai";
use(chaiAsPromised);
import { createBlockChainHelper } from "../../../src/config/BotConfig";
import { BlockChainHelper } from "../../../src/underlying-chain/BlockChainHelper";
import { SourceId } from "../../../src/verification/sources/sources";

let blockChainHelper: BlockChainHelper;
const sourceId: SourceId = SourceId.XRP;

const txHash = "531f9537bb82705877cadb918ddfad9d3051b0a59a263cf2fdf6e84fcf815e10";
const blockId = 37689276;
const blockHash = "b9011374d69b34f948313ef843249b8063776ecb9b0ed59eb91e8f86ebbfa272";

describe("XRP blockchain tests", async () => {

    before(async () => {
        blockChainHelper = createBlockChainHelper(sourceId);
    })

    it("Should retrieve transaction", async () => {
        const retrievedTransaction = await blockChainHelper.getTransaction(txHash);
        expect(txHash.toUpperCase()).to.be.eq(retrievedTransaction?.hash.toUpperCase());
    });

    it("Should retrieve block (hash)", async () => {
        const retrievedBlock = await blockChainHelper.getBlock(blockHash);
        expect(blockId).to.be.eq(retrievedBlock?.number);
    });

    it("Should retrieve block (number)", async () => {
        const retrievedBlock = await blockChainHelper.getBlockAt(blockId);
        expect(blockId).to.be.eq(retrievedBlock?.number);
    });

    it("Should retrieve block height", async () => {
        const retrievedHeight = await blockChainHelper.getBlockHeight();
        expect(retrievedHeight).to.be.greaterThanOrEqual(blockId);
    });

    it("Should not retrieve transaction block - not implemented", async () => {
        await expect(blockChainHelper.getTransactionBlock()).to.eventually.be.rejectedWith("Method not implemented on chain. Use indexer.").and.be.an.instanceOf(Error);
    });

    it("Should not retrieve balance - not implemented", async () => {
        await expect(blockChainHelper.getBalance()).to.eventually.be.rejectedWith("Method not implemented on chain. Use wallet.").and.be.an.instanceOf(Error);
    });

    it("Should not retrieve transaction with invalid hash", async () => {
        const invalidTxHash = txHash.slice(0,36);
        const retrievedTransaction = await blockChainHelper.getTransaction(invalidTxHash);
        expect(retrievedTransaction).to.be.null;
    });

    it("Should not retrieve block with invalid number", async () => {
        const blockHeight = await blockChainHelper.getBlockHeight();
        const invalidBlockNumber = blockHeight * 100;
        const retrievedBlock = await blockChainHelper.getBlockAt(invalidBlockNumber);
        expect(retrievedBlock).to.be.null;
    });

    it("Should not retrieve block with invalid hash", async () => {
        const invalidBlockHash = blockHash.slice(0,36);
        const retrievedBlock = await blockChainHelper.getBlock(invalidBlockHash);
        expect(retrievedBlock).to.be.null;
    });

});
