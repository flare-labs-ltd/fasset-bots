import axios, { AxiosInstance } from "axios";
import { BlockchainIndexerHelper } from "../underlying-chain/BlockchainIndexerHelper";
import { IBlock, IBlockId, ITransaction } from "../underlying-chain/interfaces/IBlockChain";
import { MockChain } from "./MockChain";
import { ChainId } from "../underlying-chain/ChainId";
import BN from "bn.js";

export class MockIndexer extends BlockchainIndexerHelper {
    static deepCopyWithObjectCreate = true;

    client: AxiosInstance;
    constructor(
        public indexerWebServerUrls: string[],
        public chainId: ChainId,
        public chain: MockChain
    ) {
        super(indexerWebServerUrls, chainId, [""]);
        this.client = axios.create({});
    }

    finalizationBlocks: number = this.chain.finalizationBlocks;
    secondsPerBlock: number = this.chain.secondsPerBlock;

    async getTransaction(txHash: string): Promise<ITransaction | null> {
        return await this.chain.getTransaction(txHash);
    }

    async getTransactionBlock(txHash: string): Promise<IBlockId | null> {
        return await this.chain.getTransactionBlock(txHash);
    }

    async getBalance(): Promise<BN> {
        throw new Error("Method not implemented on indexer. Use wallet.");
    }

    async getBlock(blockHash: string): Promise<IBlock | null> {
        return await this.chain.getBlock(blockHash);
    }

    async getBlockAt(blockNumber: number): Promise<IBlock | null> {
        return await this.chain.getBlockAt(blockNumber);
    }

    async getCurrentBlockHeight(): Promise<number> {
        return await this.chain.getCurrentBlockHeight();
    }

    async getLastFinalizedBlockNumber(): Promise<number> {
        return await this.chain.getLastFinalizedBlockNumber();
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
