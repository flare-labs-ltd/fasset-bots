import { expect } from "chai";
import { createWalletClient } from "../../../src/config/BotConfig";
import { BlockChainIndexerHelper } from "../../../src/underlying-chain/BlockChainIndexerHelper";
import { TX_BLOCKED, TX_FAILED, TX_SUCCESS } from "../../../src/underlying-chain/interfaces/IBlockChain";
import { SourceId } from "../../../src/verification/sources/sources";
// eslint-disable-next-line @typescript-eslint/no-var-requires
const rewire = require("rewire");
const rewiredBlockChainIndexerHelper = rewire("../../../src/underlying-chain/BlockChainIndexerHelper");
const rewiredBlockChainIndexerHelperClass = rewiredBlockChainIndexerHelper.__get__('BlockChainIndexerHelper');

let blockChainIndexerClient: BlockChainIndexerHelper;
const sourceId: SourceId = SourceId.XRP;

const txHash = "60fdd6901a43f3d814db0a132b237a38c782615c8a3a71c4ce7f090e64d9eb50";
const blockId = 2620269;
const blockHash = "395066007a0c47adf5b5ca62a75c124b24868b12ad370f2050bc47fc18f3d88b";

describe("XRP blockchain tests via indexer", async () => {
    let rewiredBlockChainIndexerClient: typeof rewiredBlockChainIndexerHelperClass;

    before(async () => {
        //TODO no indexer yet
        rewiredBlockChainIndexerClient = new rewiredBlockChainIndexerHelperClass("", sourceId, createWalletClient(sourceId));
    })

    it.skip("Should retrieve transaction", async () => {
        const retrievedTransaction = await blockChainIndexerClient.getTransaction(txHash);
        expect(txHash).to.be.eq(retrievedTransaction?.hash);
    });

    it.skip("Should retrieve block (hash)", async () => {
        const retrievedBlock = await blockChainIndexerClient.getBlock(blockHash);
        expect(blockId).to.be.eq(retrievedBlock?.number);
    });

    it.skip("Should retrieve block (number)", async () => {
        const retrievedBlock = await blockChainIndexerClient.getBlockAt(blockId);
        expect(blockId).to.be.eq(retrievedBlock?.number);
    });

    it.skip("Should retrieve block height", async () => {
        const retrievedHeight = await blockChainIndexerClient.getBlockHeight();
        expect(retrievedHeight).to.be.greaterThanOrEqual(blockId);
    });

    it.skip("Should retrieve transaction block", async () => {
        const transactionBlock = await blockChainIndexerClient.getTransactionBlock(txHash);
        expect(transactionBlock?.number).to.be.eq(blockId);
        expect(transactionBlock?.hash).to.be.eq(blockHash);
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

});