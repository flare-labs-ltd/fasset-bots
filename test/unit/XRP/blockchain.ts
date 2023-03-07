const chai = require('chai');
chai.use(require('chai-as-promised'));
import { expect } from "chai";
import { createBlockChainHelper } from "../../../src/config/BotConfig";
import { BlockChainHelper } from "../../../src/underlying-chain/BlockChainHelper";
import { SourceId } from "../../../src/verification/sources/sources";

let blockChainHelper: BlockChainHelper;
const sourceId: SourceId = SourceId.XRP;

const txHash = "CA4E465B8009C315783A6005AC6B40AA083A4317C3D3A6C123E33B8A908174B2";
const blockId = 35435676;
const blockHash = "926801238ace41e1e799210574efca4b5b2f04574ee38988bbd2f48818f08d2c";
const fundedAddress = "rpZ1bX5RqATDiB7iskGLmspKLrPbg5X3y8";

describe("XRP blockchain tests", async () => {

    before(async () => {
        blockChainHelper = createBlockChainHelper(sourceId);
    })

    it("Should retrieve transaction", async () => {
        const retrievedTransaction = await blockChainHelper.getTransaction(txHash);
        expect(txHash).to.be.eq(retrievedTransaction?.hash);
    });

    it("Should retrieve balance", async () => {
        const balance = await blockChainHelper.getBalance(fundedAddress);
        expect(balance.gten(0)).to.be.true;
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

    it("Should not retrieve transaction block", async () => {
        await expect(blockChainHelper.getTransactionBlock(txHash)).to.eventually.be.rejectedWith("Method not implemented.").and.be.an.instanceOf(Error);
    });

    it("Should retrieve transaction fee", async () => {
        const fee = await blockChainHelper.getTransactionFee();
        expect(fee.toString()).to.not.be.null;
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
