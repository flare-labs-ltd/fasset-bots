import { expect } from "chai";
import { createBlockChainIndexerHelper, createWalletClient } from "../../../src/config/BotConfig";
import { BlockChainIndexerHelper } from "../../../src/underlying-chain/BlockChainIndexerHelper";
import { TX_BLOCKED, TX_FAILED, TX_SUCCESS } from "../../../src/underlying-chain/interfaces/IBlockChain";
import { SourceId } from "../../../src/verification/sources/sources";
import rewire from "rewire";
import { requireEnv, toBN } from "../../../src/utils/helpers";
const rewiredBlockChainIndexerHelper = rewire("../../../src/underlying-chain/BlockChainIndexerHelper");
const rewiredBlockChainIndexerHelperClass = rewiredBlockChainIndexerHelper.__get__("BlockChainIndexerHelper");

const sourceId: SourceId = SourceId.XRP;
const txHash = "531f9537bb82705877cadb918ddfad9d3051b0a59a263cf2fdf6e84fcf815e10";
const blockId = 37689276;
const blockHash = "b9011374d69b34f948313ef843249b8063776ecb9b0ed59eb91e8f86ebbfa272";

describe("XRP blockchain tests via indexer", async () => {
    let rewiredBlockChainIndexerClient: typeof rewiredBlockChainIndexerHelperClass;
    let blockChainIndexerClient: BlockChainIndexerHelper;

    before(async () => {
        rewiredBlockChainIndexerClient = new rewiredBlockChainIndexerHelperClass("", sourceId, "");
        blockChainIndexerClient = createBlockChainIndexerHelper(requireEnv("INDEXER_XRP_WEB_SERVER_URL"), sourceId, requireEnv("INDEXER_XRP_API_KEY"));
    })

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
    });

});