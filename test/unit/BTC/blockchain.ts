import chaiAsPromised from "chai-as-promised";
import { expect, use } from "chai";
use(chaiAsPromised);
import { createBlockChainHelper } from "../../../src/config/BotConfig";
import { BlockChainHelper } from "../../../src/underlying-chain/BlockChainHelper";
import { SourceId } from "../../../src/verification/sources/sources";

let blockChainHelper: BlockChainHelper;
const sourceId: SourceId = SourceId.BTC;

const txHash = "16efd547467b1132a2dfbed853bbf8eaa2372ed70566d1c927ae730c715de196";
const blockId = 780767;
const blockHash = "000000000000000000005cdf6d623e9c864383d11e53db0101a9f702940b71e5";
const minedTxHash = "bceb9ce14629611967678fd0040c19c457e95cbca66394b315a3fa18605448ac";

describe("BTC blockchain tests", async () => {

    before(async () => {
        blockChainHelper = createBlockChainHelper(sourceId);
    })

    it("Should retrieve transaction", async () => {
        const retrievedTransaction = await blockChainHelper.getTransaction(txHash);
        expect(txHash).to.be.eq(retrievedTransaction?.hash);
    });

    it("Should retrieve transaction 2", async () => {
        const retrievedTransaction = await blockChainHelper.getTransaction(minedTxHash);
        expect(minedTxHash).to.be.eq(retrievedTransaction?.hash);
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

});
