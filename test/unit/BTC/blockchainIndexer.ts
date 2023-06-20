import { TX_SUCCESS } from "../../../src/underlying-chain/interfaces/IBlockChain";
import { web3 } from "../../../src/utils/web3";
import { SourceId } from "../../../src/verification/sources/sources";
import rewire from "rewire";
import { createBlockChainIndexerHelper } from "../../../src/config/BotConfig";
import { BlockChainIndexerHelper } from "../../../src/underlying-chain/BlockChainIndexerHelper";
import chaiAsPromised from "chai-as-promised";
import { expect, use } from "chai";
use(chaiAsPromised);
const rewiredBlockChainIndexerHelper = rewire("../../../src/underlying-chain/BlockChainIndexerHelper");
const rewiredBlockChainIndexerHelperClass = rewiredBlockChainIndexerHelper.__get__("BlockChainIndexerHelper");

const sourceId: SourceId = SourceId.BTC;
const txHash = "aa1e55ab8926ee3504701494712a308b6f3948c968f1c86734b6588eed648854";
const blockId = 2436977;
const blockHash = "000000000000334be701bbb914e2171a669706372b4cab7d051c934524f7e708";
const txReference = "0000000000000000000000000000000000000000000000000000000000000000";
const invalidTxHash = txHash.slice(2);

describe.skip("BTC blockchain tests via indexer", async () => {
    let rewiredBlockChainIndexerClient: typeof rewiredBlockChainIndexerHelperClass;
    let blockChainIndexerClient: BlockChainIndexerHelper;

    before(async () => {
        rewiredBlockChainIndexerClient = new rewiredBlockChainIndexerHelperClass(sourceId);
        blockChainIndexerClient = createBlockChainIndexerHelper(sourceId);
    })

    it("Should retrieve transaction", async () => {
        const retrievedTransaction = await blockChainIndexerClient.getTransaction(txHash);
        expect(txHash.toUpperCase()).to.be.eq(retrievedTransaction?.hash.toUpperCase());
    });

    it("Should not retrieve transaction - invalid hash", async () => {
        const retrievedTransaction = await blockChainIndexerClient.getTransaction(invalidTxHash);
        expect(retrievedTransaction).to.be.null;
    });

    it("Should retrieve block (hash)", async () => {
        const retrievedBlock = await blockChainIndexerClient.getBlock(blockHash);
        expect(blockId).to.be.eq(retrievedBlock?.number);
    });

    it("Should not retrieve block (hash) - invalid hash", async () => {
        const retrievedBlock = await blockChainIndexerClient.getBlock(invalidTxHash);
        expect(retrievedBlock).to.be.null;
    });

    it("Should retrieve block (number)", async () => {
        const retrievedBlock = await blockChainIndexerClient.getBlockAt(blockId);
        expect(blockId).to.be.eq(retrievedBlock?.number);
    });

    it("Should not retrieve block (number) - number higher than block height", async () => {
        const retrievedHeight = await blockChainIndexerClient.getBlockHeight();
        const invalidNumber = retrievedHeight * 10;
        const retrievedBlock = await blockChainIndexerClient.getBlockAt(invalidNumber);
        expect(retrievedBlock).to.be.null;
    });

    it("Should retrieve block (number)", async () => {
        const retrievedBlock = await blockChainIndexerClient.getBlockAt(blockId);
        expect(blockId).to.be.eq(retrievedBlock?.number);
    });

    it("Should retrieve block height", async () => {
        const retrievedHeight = await blockChainIndexerClient.getBlockHeight();
        expect(retrievedHeight).to.be.greaterThanOrEqual(blockId);
    });

    it("Should retrieve transaction block", async () => {
        const transactionBlock = await blockChainIndexerClient.getTransactionBlock(txHash);
        expect(transactionBlock?.number).to.be.eq(blockId);
        expect(transactionBlock?.hash.toUpperCase()).to.be.eq(blockHash.toUpperCase());
    });

    it("Should not retrieve transaction block - invalid hash", async () => {
        const invalidHash = txHash.slice(2);
        const transactionBlock = await blockChainIndexerClient.getTransactionBlock(invalidHash);
        expect(transactionBlock).to.be.null;
    });

    it.skip("Should retrieve transaction by reference", async () => {
        const retrievedTransaction = await blockChainIndexerClient.getTransactionsByReference(txReference, true);
        expect(retrievedTransaction.length).to.be.gt(0);
    });

    it("Should not retrieve transaction by reference - invalid reference", async () => {
        const invalidRef = txReference.slice(2);
        const retrievedTransaction = await blockChainIndexerClient.getTransactionsByReference(invalidRef);
        expect(retrievedTransaction.length).to.eq(0);
    });

    it("Should not retrieve transaction by reference - random reference", async () => {
        const randomRef = web3.utils.randomHex(32);
        const retrievedTransaction = await blockChainIndexerClient.getTransactionsByReference(randomRef);
        expect(retrievedTransaction.length).to.eq(0);
    });

    it("Should retrieve transaction by block range", async () => {
        const retrievedTransactions0 = await blockChainIndexerClient.getTransactionsWithinBlockRange(blockId, blockId, true);
        expect(retrievedTransactions0.length).to.be.gt(0);
        const retrievedTransactions1 = await blockChainIndexerClient.getTransactionsWithinBlockRange(blockId, blockId - 1);
        expect(retrievedTransactions1.length).to.eq(0);
    });

    it("Should return successful status", async () => {
        expect(rewiredBlockChainIndexerClient.successStatus({})).to.eq(TX_SUCCESS);
    });

    it("Should not retrieve balance - not implemented", async () => {
        await expect(blockChainIndexerClient.getBalance()).to.eventually.be.rejectedWith("Method not implemented on indexer. Use wallet").and.be.an.instanceOf(Error);
    });

    it("Should not handle inputs/outputs - wrong source id", async () => {
        const localSourceId = 200 as SourceId;
        const localRewiredBlockChainIndexerClient = new rewiredBlockChainIndexerHelperClass("", localSourceId, "");
        await expect(localRewiredBlockChainIndexerClient.handleInputsOutputs({ transactionType: "payment", response: { data: {} } }, false)).to.eventually.be.rejectedWith(`Invalid SourceId: ${localSourceId}.`).and.be.an.instanceOf(Error);
    });

    it("Should not extract transaction ids - []", async () => {
        const ids = await rewiredBlockChainIndexerClient.extractTransactionIds(0);
        expect(ids.length).to.eq(0);
    });

    it("Should handle 'empty' inputs/outputs", async () => {
        const outputs = await rewiredBlockChainIndexerClient.UTXOInputsOutputs("", { vout: [] }, false);
        expect(outputs[0][0]).to.eq("");
        expect(outputs[0][1].eqn(0)).to.be.true;
        const inputs = await rewiredBlockChainIndexerClient.UTXOInputsOutputs("", { vin: [] }, true);
        expect(inputs[0][0]).to.eq("");
        expect(inputs[0][1].eqn(0)).to.be.true;
    });

});
