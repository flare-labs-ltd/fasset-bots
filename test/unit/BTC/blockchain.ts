import { expect } from "chai";
import { BlockChainHelper } from "../../../src/underlying-chain/BlockChainHelper";
import { SourceId } from "../../../src/verification/sources/sources";
import { createTestBlockChainHelper } from "../../utils/test-bot-config";

let blockChainHelper: BlockChainHelper;
const sourceId: SourceId = SourceId.BTC;

const txHash = "c545084a28520ac62dc113b951e981b11dd57b23122a5e814c34fb9e15b23890";
const blockId = 2347669;
const blockHash = "000000000000000f68dec9af25075839c9a010d8631c675f5841fb71145c92a5";
const fundedAddress = "mzM88w7CdxrFyzE8RKZmDmgYQgT5YPdA6S";

describe("BTC blockchain tests", async () => {

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
        const transactionBlock = await blockChainHelper.getTransactionBlock(txHash);
        expect(transactionBlock?.number).to.be.eq(blockId);
        expect(transactionBlock?.hash).to.be.eq(blockHash);
    });
    
});
