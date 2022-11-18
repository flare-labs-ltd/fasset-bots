const chai = require('chai');
chai.use(require('chai-as-promised'));
import { expect } from "chai";
import { BlockChainHelper } from "../../../src/underlying-chain/BlockChainHelper";
import { SourceId } from "../../../src/verification/sources/sources";
import { createTestBlockChainHelper } from "../../utils/test-bot-config";

let blockChainHelper: BlockChainHelper;
const sourceId: SourceId = SourceId.XRP;

const txHash = "6C43D0F27F98B03979DC8869AAABDAD6B3C4E023580A2B25349C7FF5C1A52BEB";
const blockId = 31387252;
const blockHash = "53C070D1842C17A9A4A3980CC5168BCA7A8486440219E6A430717911BF10099D";
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
