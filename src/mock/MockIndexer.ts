import axios, { AxiosInstance } from "axios";
import { WalletClient } from "simple-wallet/dist/types";
import { BlockChainIndexerHelper } from "../underlying-chain/BlockChainIndexerHelper";
import { ITransaction } from "../underlying-chain/interfaces/IBlockChain";
import { SourceId } from "../verification/sources/sources";
import { MockChain } from "./MockChain";

export class MockIndexer extends BlockChainIndexerHelper {

    client: AxiosInstance;
    constructor(
        public indexerWebServerUrl: string,
        public sourceId: SourceId,
        public walletClient: WalletClient,
        public chain: MockChain
    ) {
        super(indexerWebServerUrl, sourceId, walletClient);
        this.client = axios.create({});
    }


    async getTransactionsWithinTimestampRange(from: number, to: number): Promise<ITransaction[] | []> {
        const blocks = this.chain.blocks;
        const rangeTransactions: ITransaction[] = [];
        for (let block of blocks) {
            if (block.timestamp >= from && block.timestamp < to) {
                for (let transaction of block.transactions) {
                    rangeTransactions.push(transaction);
                }
            }
        }
        return rangeTransactions;
    }

    async waitForUnderlyingTransactionFinalization(txHash: string, maxBlocksToWaitForTx?: number) {
        const transaction = await this.chain.getTransaction(txHash);
        this.chain.mine(this.chain.finalizationBlocks + 1);
        return transaction;
    }

    async getTransactionsByReference(reference: string): Promise<ITransaction[] | []> {
        const blocks = this.chain.blocks;
        for (let block of blocks) {
            for (let transaction of block.transactions) {
                if (transaction.reference === reference) {
                    return [transaction];
                }
            }
        }
        return [];
    }
}

