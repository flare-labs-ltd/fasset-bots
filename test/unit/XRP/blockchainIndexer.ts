import { expect } from "chai";
import { createBlockChainIndexerHelper } from "../../../src/config/BotConfig";
import { BlockChainIndexerHelper } from "../../../src/underlying-chain/BlockChainIndexerHelper";
import { TX_BLOCKED, TX_FAILED, TX_SUCCESS } from "../../../src/underlying-chain/interfaces/IBlockChain";
import { SourceId } from "../../../src/verification/sources/sources";
import rewire from "rewire";
import { toBN } from "../../../src/utils/helpers";
import { receiveBlockAndTransaction } from "../../test-utils/test-helpers";
const rewiredBlockChainIndexerHelper = rewire("../../../src/underlying-chain/BlockChainIndexerHelper");
const rewiredBlockChainIndexerHelperClass = rewiredBlockChainIndexerHelper.__get__("BlockChainIndexerHelper");

const sourceId: SourceId = SourceId.XRP;

describe("XRP blockchain tests via indexer", async () => {
    let rewiredBlockChainIndexerClient: typeof rewiredBlockChainIndexerHelperClass;
    let blockChainIndexerClient: BlockChainIndexerHelper;
    let blockId: number;
    let blockHash: string;
    let txHash: string

    before(async () => {
        rewiredBlockChainIndexerClient = new rewiredBlockChainIndexerHelperClass(sourceId);
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

});