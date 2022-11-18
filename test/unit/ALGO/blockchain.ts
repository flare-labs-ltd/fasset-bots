const chai = require('chai');
chai.use(require('chai-as-promised'));
import { expect } from "chai";
import { BlockChainHelper } from "../../../src/underlying-chain/BlockChainHelper";
import { SourceId } from "../../../src/verification/sources/sources";
import { createTestBlockChainHelper } from "../../utils/test-bot-config";

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
        blockChainHelper = createTestBlockChainHelper(sourceId);
    })

    it("Should retrieve transaction", async () => {
        const retrievedTransaction = await blockChainHelper.getTransaction(txHash0);
        expect(txHash0).to.be.eq(retrievedTransaction?.hash);
    });

    it("Should retrieve balance", async () => {
        const balance = await blockChainHelper.getBalance(fundedAddress);
        expect(balance.toNumber()).to.be.greaterThanOrEqual(0);
    });

    it("Should retrieve block (hash)", async () => {
        await expect(blockChainHelper.getBlock("blockHash")).to.eventually.be.rejected; 
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
        await expect(blockChainHelper.getTransactionBlock(txHash1)).to.eventually.be.rejected;
    });

});
