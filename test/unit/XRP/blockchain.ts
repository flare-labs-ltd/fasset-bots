const chai = require('chai');
chai.use(require('chai-as-promised'));
import { expect } from "chai";
import { BlockChainHelper } from "../../../src/underlying-chain/BlockChainHelper";
import { SourceId } from "../../../src/verification/sources/sources";
import { createTestBlockChainHelper } from "../../utils/test-bot-config";

let blockChainHelper: BlockChainHelper;
const sourceId: SourceId = SourceId.XRP;

const txHash = "1580BC9E024B55E81C09E178C92FB0B5E03F1EDB2F10225C2AD1C43F2C5607CB";
const blockId = 33694363;
const blockHash = "DCEEACF83320277B0886CA55B4AB7D7671B9202A25B1B7A935465F932758C6AF";
const fundedAddress = "rpZ1bX5RqATDiB7iskGLmspKLrPbg5X3y8";

describe("XRP blockchain tests", async () => {

    before(async () => {
        blockChainHelper = createTestBlockChainHelper(sourceId);
    })

    it("Should retrieve transaction", async () => {
        const retrievedTransaction = await blockChainHelper.getTransaction(txHash);
        expect(txHash).to.be.eq(retrievedTransaction?.hash);
    });

    it("Should retrieve balance", async () => {
        const balance = await blockChainHelper.getBalance(fundedAddress);
        expect(balance.toNumber()).to.be.greaterThanOrEqual(0);
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

    it("Should retrieve transaction block", async () => {
        await expect(blockChainHelper.getTransactionBlock(txHash)).to.eventually.be.rejected;
    });

});
