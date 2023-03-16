// eslint-disable-next-line @typescript-eslint/no-var-requires
const chai = require('chai');
// eslint-disable-next-line @typescript-eslint/no-var-requires
chai.use(require('chai-as-promised'));
import { expect } from "chai";
import { createBlockChainHelper } from "../../../src/config/BotConfig";
import { BlockChainHelper } from "../../../src/underlying-chain/BlockChainHelper";
import { SourceId } from "../../../src/verification/sources/sources";

let blockChainHelper: BlockChainHelper;
const sourceId: SourceId = SourceId.DOGE;

const txHash = "0f37b4767b0e47fa7357ad21f294604a85ed389a588642f94d752c587e2a5d55";
const blockId = 4634283;
const blockHash = "795ad75ab0287f87e9c20e400760825ee7f5100aeb4dc0414d3570e308cbaca0";

describe("DOGE blockchain tests", async () => {

    before(async () => {
        blockChainHelper = createBlockChainHelper(sourceId);
    })

    it("Should retrieve transaction", async () => {
        const retrievedTransaction = await blockChainHelper.getTransaction(txHash);
        expect(txHash).to.be.eq(retrievedTransaction?.hash);
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
