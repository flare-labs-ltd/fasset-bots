import { expect } from "chai";
import { TX_SUCCESS } from "../../../src/underlying-chain/interfaces/IBlockChain";
import { requireEnv } from "../../../src/utils/helpers";
import { web3 } from "../../../src/utils/web3";
import { SourceId } from "../../../src/verification/sources/sources";
import rewire from "rewire";
const rewiredBlockChainIndexerHelper = rewire("../../../src/underlying-chain/BlockChainIndexerHelper");
const rewiredBlockChainIndexerHelperClass = rewiredBlockChainIndexerHelper.__get__("BlockChainIndexerHelper");

const sourceId: SourceId = SourceId.BTC;
const txHash = "c627a78e6de95684787d17aacd9a6821a02b1fd309afc6767a07dffd83ea6a2e";
const blockId = 2;
const blockHash = "405787fa12a823e0f2b7631cc41b3ba8828b3321ca811111fa75cd3aa3bb5ace";
const txReference = "0x000000000000000000000000000000000000000000000000000000fd83ea6a2e";
const invalidTxHash = txHash.slice(2);

describe("BTC blockchain tests via indexer", async () => {
    let rewiredBlockChainIndexerClient: typeof rewiredBlockChainIndexerHelperClass;

    before(async () => {
        rewiredBlockChainIndexerClient = new rewiredBlockChainIndexerHelperClass(requireEnv('INDEXER_WEB_SERVER_URL'), sourceId, requireEnv('INDEXER_API_KEY'));
    })

    it("Should retrieve transaction", async () => {
        const retrievedTransaction = await rewiredBlockChainIndexerClient.getTransaction(txHash);
        expect(txHash).to.be.eq(retrievedTransaction?.hash);
    });

    it("Should not retrieve transaction - invalid hash", async () => {
        const retrievedTransaction = await rewiredBlockChainIndexerClient.getTransaction(invalidTxHash);
        expect(retrievedTransaction).to.be.null;
    });

    it("Should retrieve block (hash)", async () => {
        const retrievedBlock = await rewiredBlockChainIndexerClient.getBlock(blockHash);
        expect(blockId).to.be.eq(retrievedBlock?.number);
    });

    it("Should not retrieve block (hash) - invalid hash", async () => {
        const retrievedBlock = await rewiredBlockChainIndexerClient.getBlock(invalidTxHash);
        expect(retrievedBlock).to.be.null;
    });

    it("Should retrieve block (number)", async () => {
        const retrievedBlock = await rewiredBlockChainIndexerClient.getBlockAt(blockId);
        expect(blockId).to.be.eq(retrievedBlock?.number);
    });

    it("Should not retrieve block (number) - number higher than block height", async () => {
        const retrievedHeight = await rewiredBlockChainIndexerClient.getBlockHeight();
        const invalidNumber = retrievedHeight * 10;
        const retrievedBlock = await rewiredBlockChainIndexerClient.getBlockAt(invalidNumber);
        expect(retrievedBlock).to.be.null;
    });

    it("Should retrieve block (number)", async () => {
        const retrievedBlock = await rewiredBlockChainIndexerClient.getBlockAt(blockId);
        expect(blockId).to.be.eq(retrievedBlock?.number);
    });

    it("Should retrieve block height", async () => {
        const retrievedHeight = await rewiredBlockChainIndexerClient.getBlockHeight();
        expect(retrievedHeight).to.be.greaterThanOrEqual(blockId);
    });

    it("Should retrieve transaction block", async () => {
        const transactionBlock = await rewiredBlockChainIndexerClient.getTransactionBlock(txHash);
        expect(transactionBlock?.number).to.be.eq(blockId);
        expect(transactionBlock?.hash).to.be.eq(blockHash);
    });

    it("Should not retrieve transaction block - invalid hash", async () => {
        const invalidHash = txHash.slice(2);
        const transactionBlock = await rewiredBlockChainIndexerClient.getTransactionBlock(invalidHash);
        expect(transactionBlock).to.be.null;
    });

    it("Should retrieve transaction by reference", async () => {
        const retrievedTransaction = await rewiredBlockChainIndexerClient.getTransactionsByReference(txReference);
        expect(retrievedTransaction).to.not.be.null;
    });

    it("Should not retrieve transaction by reference - invalid reference", async () => {
        const invalidRef = txReference.slice(2);
        const retrievedTransaction = await rewiredBlockChainIndexerClient.getTransactionsByReference(invalidRef);
        expect(retrievedTransaction.length).to.eq(0);
    });

    it("Should not retrieve transaction by reference - random reference", async () => {
        const randomRef = web3.utils.randomHex(32);
        const retrievedTransaction = await rewiredBlockChainIndexerClient.getTransactionsByReference(randomRef);
        expect(retrievedTransaction.length).to.eq(0);
    });

    it("Should retrieve transaction by block range", async () => {
        const retrievedTransactions0 = await rewiredBlockChainIndexerClient.getTransactionsWithinBlockRange(blockId, blockId);
        expect(retrievedTransactions0.length).to.be.gt(0);
        const retrievedTransactions1 = await rewiredBlockChainIndexerClient.getTransactionsWithinBlockRange(blockId, blockId - 1);
        expect(retrievedTransactions1.length).to.eq(0);
    });

    it("Should return successful status", async () => {
        expect(rewiredBlockChainIndexerClient.successStatus({})).to.eq(TX_SUCCESS);
    });

    it("Should wait for underlying transaction finalization", async () => {
        const retrievedTransaction = await rewiredBlockChainIndexerClient.waitForUnderlyingTransactionFinalization(txHash, 1);
        expect(txHash).to.be.eq(retrievedTransaction?.hash);
    });

    it("Should not retrieve balance - not implemented", async () => {
        await expect(rewiredBlockChainIndexerClient.getBalance()).to.eventually.be.rejectedWith("Method not implemented on indexer. Use wallet").and.be.an.instanceOf(Error);
    });

});
