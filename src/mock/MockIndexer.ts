import axios, { AxiosInstance } from "axios";
import { BlockChainIndexerHelper } from "../underlying-chain/BlockChainIndexerHelper";
import { ITransaction } from "../underlying-chain/interfaces/IBlockChain";
import { SourceId } from "../verification/sources/sources";
import { MockChain } from "./MockChain";

export class MockIndexer extends BlockChainIndexerHelper {

    client: AxiosInstance;
    constructor(
        public indexerWebServerUrl: string,
        public sourceId: SourceId,
        public chain: MockChain
    ) {
        super(indexerWebServerUrl, sourceId, "");
        this.client = axios.create({});
    }


    async getTransactionsWithinBlockRange(from: number, to: number): Promise<ITransaction[] | []> {
        const blocks = this.chain.blocks;
        const rangeTransactions: ITransaction[] = [];
        for (const block of blocks) {
            if (block.number >= from && block.number < to) {
                for (const transaction of block.transactions) {
                    rangeTransactions.push(transaction);
                }
            }
        }
        return rangeTransactions;
    }

    async waitForUnderlyingTransactionFinalization(txHash: string) {
        const transaction = await this.chain.getTransaction(txHash);
        this.chain.mine(this.chain.finalizationBlocks + 1);
        return transaction;
    }

    async getTransactionsByReference(reference: string): Promise<ITransaction[] | []> {
        const blocks = this.chain.blocks;
        for (const block of blocks) {
            for (const transaction of block.transactions) {
                if (transaction.reference === reference) {
                    return [transaction];
                }
            }
        }
        return [];
    }
}

