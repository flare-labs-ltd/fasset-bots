import { TX_SUCCESS } from "../../../src/underlying-chain/interfaces/IBlockChain";
import { requireEnv } from "../../../src/utils/helpers";
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
const txHash = "6e555d6afce55e26bdff2559047ca07e1262adf0e4337de8618c4534cc5b9871";
const blockId = 2433332;
const blockHash = "000000000000001cd1d64cc9b566058453b6f3909c386337d61a7dc5ced426d9";
const txReference = "a78ca83b53b7976c2d7396ce0e87d17a66a81261c67d34972f4eb0a0e9cc8196";
const invalidTxHash = txHash.slice(2);

describe("BTC blockchain tests via indexer", async () => {
    let rewiredBlockChainIndexerClient: typeof rewiredBlockChainIndexerHelperClass;
    let blockChainIndexerClient: BlockChainIndexerHelper;

    before(async () => {
        rewiredBlockChainIndexerClient = new rewiredBlockChainIndexerHelperClass(requireEnv("INDEXER_BTC_WEB_SERVER_URL"), sourceId, requireEnv("INDEXER_BTC_API_KEY"));
        blockChainIndexerClient = createBlockChainIndexerHelper(requireEnv("INDEXER_BTC_WEB_SERVER_URL"), sourceId, requireEnv("INDEXER_BTC_API_KEY"));
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

    it("Should retrieve transaction by reference", async () => {
        const retrievedTransaction = await blockChainIndexerClient.getTransactionsByReference(txReference);
        expect(retrievedTransaction).to.not.be.null;
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

    it("Should wait for underlying transaction finalization", async () => {
        const retrievedTransaction = await blockChainIndexerClient.waitForUnderlyingTransactionFinalization(txHash, 1);
        expect(txHash).to.be.eq(retrievedTransaction?.hash);
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
