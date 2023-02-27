const chai = require('chai');
chai.use(require('chai-as-promised'));
import { expect } from "chai";
import { createBlockChainHelper } from "../../../src/config/BotConfig";
import { BlockChainHelper } from "../../../src/underlying-chain/BlockChainHelper";
import { SourceId } from "../../../src/verification/sources/sources";

let blockChainHelper: BlockChainHelper;
const sourceId: SourceId = SourceId.ALGO;

const txHash0 = "RGEUIORIOM6PTCP2EXZDKQRWPI6SJ4CBTH5LRYO7CLEQNYGIZS6A";
const blockId0 = 24277222;
const blockHash0 = "OI7ROABGHA6CALUY7G2QKNCCM6QF537TEOSNVBWXCY4JBLNMAKDQ";
const txHash1 = "B2WZXYL7B6QTXVZ7KKI37OYBPYW57ASSGKOEENWVEBFPG6VAHYMQ";
const blockId1 = 23614509;
const blockHash1 = "OWKKEXEU2EWD6BTDRBKO5XKGYNUP5HLTTJ2YIIDZD3O4GFBKCT6A";
const fundedAddress = "T6WVPM7WLGP3DIBWNN3LJGCUNMFRR67BVV5KNS3VJ5HSEAQ3QKTGY5ZKWM";

describe("ALGO blockchain tests", async () => {

    before(async () => {
        blockChainHelper = createBlockChainHelper(sourceId);
    })

    it("Should retrieve transaction", async () => {
        const retrievedTransaction = await blockChainHelper.getTransaction(txHash0);
        expect(txHash0).to.be.eq(retrievedTransaction?.hash);
    });

    it("Should retrieve balance", async () => {
        const balance = await blockChainHelper.getBalance(fundedAddress);
        expect(balance.gten(0)).to.be.true;
    });

    it("Should not retrieve block (hash) - not implemented", async () => {
        await expect(blockChainHelper.getBlock("blockHash")).to.eventually.be.rejectedWith("Method not implemented in ALGO.").and.be.an.instanceOf(Error);
    });

    it("Should retrieve block (number)", async () => {
        const retrievedBlock = await blockChainHelper.getBlockAt(blockId1);
        expect(blockId1).to.be.eq(retrievedBlock?.number);
    });

    it("Should retrieve block height", async () => {
        const retrievedHeight = await blockChainHelper.getBlockHeight();
        expect(retrievedHeight).to.be.greaterThanOrEqual(blockId1);
    });

    it("Should retrieve transaction block", async () => {
        await expect(blockChainHelper.getTransactionBlock(txHash1)).to.eventually.be.rejectedWith("Method not implemented.").and.be.an.instanceOf(Error);
    });

    it("Should retrieve transaction fee", async () => {
        const fee = await blockChainHelper.getTransactionFee();
        expect(fee.toString()).to.not.be.null;
    });

    it("Should not retrieve invalid transaction", async () => {
        const invalidTxHash = txHash0.slice(0,36);
        const retrievedTransaction = await blockChainHelper.getTransaction(invalidTxHash);
        expect(retrievedTransaction).to.be.null;
    });

    it("Should not retrieve block with invalid number", async () => {
        const blockHeight = await blockChainHelper.getBlockHeight();
        const invalidBlockNumber = blockHeight * 100;
        const retrievedBlock = await blockChainHelper.getBlockAt(invalidBlockNumber);
        expect(retrievedBlock).to.be.null;
    });

});
