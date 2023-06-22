import { expect, use } from "chai";
import { createBlockChainIndexerHelper } from "../../../src/config/BotConfig";
import { BlockChainIndexerHelper } from "../../../src/underlying-chain/BlockChainIndexerHelper";
import { TX_BLOCKED, TX_FAILED, TX_SUCCESS } from "../../../src/underlying-chain/interfaces/IBlockChain";
import { SourceId } from "../../../src/verification/sources/sources";
import rewire from "rewire";
import { toBN } from "../../../src/utils/helpers";
import { receiveBlockAndTransaction } from "../../test-utils/test-helpers";
const rewiredBlockChainIndexerHelper = rewire("../../../src/underlying-chain/BlockChainIndexerHelper");
const rewiredBlockChainIndexerHelperClass = rewiredBlockChainIndexerHelper.__get__("BlockChainIndexerHelper");
import chaiAsPromised from "chai-as-promised";
use(chaiAsPromised);



describe("XRP blockchain tests via indexer", async () => {
    const sourceId: SourceId = SourceId.XRP;
    let rewiredBlockChainIndexerClient: typeof rewiredBlockChainIndexerHelperClass;
    let blockChainIndexerClient: BlockChainIndexerHelper;
    let blockId: number;
    let blockHash: string;
    let txHash: string

    before(async () => {
        rewiredBlockChainIndexerClient = new rewiredBlockChainIndexerHelperClass("", sourceId, "");
        blockChainIndexerClient = createBlockChainIndexerHelper(sourceId);
        // TODO could be done better
        const info = await receiveBlockAndTransaction(sourceId, blockChainIndexerClient);
        if (info) {
            blockId = info?.blockNumber;
            blockHash = info?.blockHash;
            txHash = info!.txHash!;
        }
    });

    it("Should retrieve transaction", async () => {
        const retrievedTransaction = await blockChainIndexerClient.getTransaction(txHash);
        expect(txHash.toUpperCase()).to.be.eq(retrievedTransaction?.hash.toUpperCase());
    });

    it("Should retrieve block (hash)", async () => {
        const retrievedBlock = await blockChainIndexerClient.getBlock(blockHash);
        expect(blockId).to.be.eq(retrievedBlock?.number);
    });

    it("Should not retrieve block (hash)", async () => {
        const blHash = "50DD4ED48D22EB7232C836FBC25B33DB5A7345E139DB7E967717D76606103E1C";
        const retrievedBlock = await blockChainIndexerClient.getBlock(blHash);
        expect(retrievedBlock).to.be.null;
    });

    it("Should retrieve block (number)", async () => {
        const retrievedBlock = await blockChainIndexerClient.getBlockAt(blockId);
        expect(blockId).to.be.eq(retrievedBlock?.number);
    });

    it("Should not retrieve block (number)", async () => {
        const blockNumber = 38760363;
        const retrievedBlock = await blockChainIndexerClient.getBlockAt(blockNumber);
        expect(retrievedBlock).to.be.null;
    });

    it("Should retrieve block height", async () => {
        const retrievedHeight = await blockChainIndexerClient.getBlockHeight();
        expect(retrievedHeight).to.be.greaterThanOrEqual(blockId);
    });

    it("Should retrieve transaction block", async () => {
        const transactionBlock = await blockChainIndexerClient.getTransactionBlock(txHash);
        expect(transactionBlock?.number).to.be.eq(blockId);
        expect(transactionBlock?.hash.toLocaleUpperCase()).to.be.eq(blockHash.toUpperCase());
    });

    it("Should not retrieve transaction block", async () => {
        const transactionHash = "236DDA439C92DE126B549F5DFD1B813C8F1E68A94B27BFBD3B830B16B26C83DA";
        const transactionBlock = await blockChainIndexerClient.getTransactionBlock(transactionHash);
        expect(transactionBlock).to.be.null;
    });

    it("Should return appropriate status", async () => {
        const data = {
            response: {
                data: {
                    result: {
                        meta: {
                            AffectedNodes: [{ ModifiedNode: [Object] }, { ModifiedNode: [Object] }],
                            TransactionIndex: 1,
                            TransactionResult: 'tesSUCCESS',
                            delivered_amount: '1000000'
                        }
                    }
                }
            }
        };
        expect(rewiredBlockChainIndexerClient.successStatus(data)).to.eq(TX_SUCCESS);
        data.response.data.result.meta.TransactionResult = 'tec';
        expect(rewiredBlockChainIndexerClient.successStatus(data)).to.eq(TX_FAILED);
        data.response.data.result.meta.TransactionResult = 'tem';
        expect(rewiredBlockChainIndexerClient.successStatus(data)).to.eq(TX_FAILED);
        data.response.data.result.meta.TransactionResult = 'tecDST_TAG_NEEDED';
        expect(rewiredBlockChainIndexerClient.successStatus(data)).to.eq(TX_BLOCKED);
        data.response.data.result.meta.TransactionResult = 'tecNO_DST';
        expect(rewiredBlockChainIndexerClient.successStatus(data)).to.eq(TX_BLOCKED);
        data.response.data.result.meta.TransactionResult = 'tecNO_DST_INSUF_XRP';
        expect(rewiredBlockChainIndexerClient.successStatus(data)).to.eq(TX_BLOCKED);
        data.response.data.result.meta.TransactionResult = 'tecNO_PERMISSION';
        expect(rewiredBlockChainIndexerClient.successStatus(data)).to.eq(TX_BLOCKED);
    });

    it("Should return inputs/outputs accordingly", async () => {
        const data = {
            isNativePayment: true,
            response: {
                data: {
                    result: {
                        Account: "rQ3fNyLjbvcDaPNS4EAJY8aT9zR3uGk17c",
                        Amount: 100,
                        Destination: "rQ3fNyLjbvcDaPNS4EAJY8aT9zR3uGk17c",
                        meta: {
                            delivered_amount: '100'
                        }
                    }
                }
            }
        };
        const dataWithFee = {
            isNativePayment: true,
            response: {
                data: {
                    result: {
                        Account: "rQ3fNyLjbvcDaPNS4EAJY8aT9zR3uGk17c",
                        Amount: 100,
                        Fee: 15,
                        meta: {
                            delivered_amount: '100'
                        }
                    }
                }
            }
        };
        const inputs = rewiredBlockChainIndexerClient.XRPInputsOutputs(data, true);
        expect(inputs[0][0]).to.eq(data.response.data.result.Account);
        expect(inputs[0][1].eqn(data.response.data.result.Amount)).to.be.true;

        const inputsWithFee = rewiredBlockChainIndexerClient.XRPInputsOutputs(dataWithFee, true);
        expect(inputsWithFee[0][0]).to.eq(dataWithFee.response.data.result.Account);
        expect(inputsWithFee[0][1].eqn(dataWithFee.response.data.result.Amount + dataWithFee.response.data.result.Fee)).to.be.true;

        const outputs = rewiredBlockChainIndexerClient.XRPInputsOutputs(data, false);
        expect(outputs[0][0]).to.eq(data.response.data.result.Account);
        expect(outputs[0][1].eq(toBN(data.response.data.result.meta.delivered_amount))).to.be.true;

        data.isNativePayment = false;
        const inputsNotNativePayment = rewiredBlockChainIndexerClient.XRPInputsOutputs(data, true);
        expect(inputsNotNativePayment[0][0]).to.eq(data.response.data.result.Account);
        expect(inputsNotNativePayment[0][1].eqn(0)).to.be.true;

        dataWithFee.isNativePayment = false;
        const inputsWithFeeNotNativePayment = rewiredBlockChainIndexerClient.XRPInputsOutputs(dataWithFee, true);
        expect(inputsWithFeeNotNativePayment[0][0]).to.eq(data.response.data.result.Account);
        expect(inputsWithFeeNotNativePayment[0][1].eqn(dataWithFee.response.data.result.Fee)).to.be.true;

        const outputsNotNativePayment = rewiredBlockChainIndexerClient.XRPInputsOutputs(data, false);
        expect(outputsNotNativePayment[0][0]).to.eq("");
        expect(outputsNotNativePayment[0][1].eqn(0)).to.be.true;
    });

    it("Should wait for underlying transaction finalization", async () => {
        if (txHash) {
            const retrievedTransaction = await blockChainIndexerClient.waitForUnderlyingTransactionFinalization(txHash, 1);
            expect(txHash).to.be.eq(retrievedTransaction?.hash);
        }
    });

    it("Should wait for underlying transaction finalization 2", async () => {
        const retrievedTransaction = await blockChainIndexerClient.waitForUnderlyingTransactionFinalization("txHash", 0);
        expect(retrievedTransaction).to.be.null;
    });

    it("Should not get balance - not implemented", async () => {
        await expect(blockChainIndexerClient.getBalance()).to.eventually.be.rejectedWith("Method not implemented on indexer. Use wallet.").and.be.an.instanceOf(Error);
    });

    it("Should get transaction by reference - empty array", async () => {
        const retrievedTransaction1 = await blockChainIndexerClient.getTransactionsByReference("txHash");
        expect(retrievedTransaction1.length).to.be.gte(0);
        const retrievedTransaction2 = await blockChainIndexerClient.getTransactionsByReference("txHash", true);
        expect(retrievedTransaction2.length).to.be.gte(0);
    });

    it("Should get transactions within block range", async () => {
        const retrievedTransaction1 = await blockChainIndexerClient.getTransactionsWithinBlockRange(blockId - 1, blockId);
        expect(retrievedTransaction1.length).to.be.gte(0);
        const retrievedTransaction2 = await blockChainIndexerClient.getTransactionsWithinBlockRange(blockId - 1, blockId, true);
        expect(retrievedTransaction2.length).to.be.gte(0);
    });

});


describe("LTC blockchain tests via indexer", async () => {
    const sourceId: SourceId = SourceId.LTC;
    it("Should not create blockChainIndexerHelper - not supported chain id", async () => {
        const fn = () => {
            return createBlockChainIndexerHelper(sourceId);
        };
        expect(fn).to.throw(`SourceId ${sourceId} not supported.`);
    });

    it("Should not handle inputs and outputs - not supported chain id", async () => {
        const rewiredBlockChainIndexerClient = new rewiredBlockChainIndexerHelperClass("", sourceId, "");
        await expect(rewiredBlockChainIndexerClient.handleInputsOutputs({ transactionType: "type", response: { data: {} } })).to.eventually.be.rejectedWith(`Invalid SourceId: ${sourceId}.`).and.be.an.instanceOf(Error);
    });

});

describe("DOGE blockchain tests via indexer", async () => {
    const sourceId: SourceId = SourceId.DOGE;
    let rewiredBlockChainIndexerClient: typeof rewiredBlockChainIndexerHelperClass;
    let blockChainIndexerClient: BlockChainIndexerHelper;
    let blockId: number;
    let blockHash: string;
    let txHash: string

    before(async () => {
        rewiredBlockChainIndexerClient = new rewiredBlockChainIndexerHelperClass("", sourceId, "");
        blockChainIndexerClient = createBlockChainIndexerHelper(sourceId);
        // TODO could be done better
        const info = await receiveBlockAndTransaction(sourceId, blockChainIndexerClient);
        if (info) {
            blockId = info?.blockNumber;
            blockHash = info?.blockHash;
            txHash = info!.txHash!;
        }
    });

    it("Should retrieve transaction", async () => {
        const retrievedTransaction = await blockChainIndexerClient.getTransaction(txHash);
        expect(txHash.toUpperCase()).to.be.eq(retrievedTransaction?.hash.toUpperCase());
    });

    it("Should retrieve block (hash)", async () => {
        const retrievedBlock = await blockChainIndexerClient.getBlock(blockHash);
        expect(blockId).to.be.eq(retrievedBlock?.number);
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
        expect(transactionBlock?.hash.toLocaleUpperCase()).to.be.eq(blockHash.toUpperCase());
    });

    it("Should return appropriate status", async () => {
        expect(rewiredBlockChainIndexerClient.successStatus({ data: "data" })).to.eq(TX_SUCCESS);
    });

});

describe("BTC blockchain tests via indexer", async () => {
    const sourceId: SourceId = SourceId.BTC;
    let blockChainIndexerClient: BlockChainIndexerHelper;
    let blockId: number;
    let blockHash: string;
    let txHash: string

    before(async () => {
        blockChainIndexerClient = createBlockChainIndexerHelper(sourceId);
        // TODO could be done better
        const info = await receiveBlockAndTransaction(sourceId, blockChainIndexerClient);
        if (info) {
            blockId = info?.blockNumber;
            blockHash = info?.blockHash;
            txHash = info!.txHash!;
        }
    });

    it("Should retrieve transaction", async () => {
        const retrievedTransaction = await blockChainIndexerClient.getTransaction(txHash);
        expect(txHash.toUpperCase()).to.be.eq(retrievedTransaction?.hash.toUpperCase());
    });

    it("Should retrieve block (hash)", async () => {
        const retrievedBlock = await blockChainIndexerClient.getBlock(blockHash);
        expect(blockId).to.be.eq(retrievedBlock?.number);
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
        expect(transactionBlock?.hash.toLocaleUpperCase()).to.be.eq(blockHash.toUpperCase());
    });

});