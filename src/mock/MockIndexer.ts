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
    

    getTransactionsWithinTimestampRange(from: number, to: number): Promise<ITransaction[]> {
        throw new Error("Method not implemented.");
    }
    waitForUnderlyingTransactionFinalization(txHash: string, maxBlocksToWaitForTx?: number | undefined): Promise<ITransaction | null> {
        throw new Error("Method not implemented.");
    }

    async getTransactionsByReference(reference: string): Promise<ITransaction[] | []> {
        const blocks = this.chain.blocks;
        for (let block of blocks) {
                for (let transaction of block.transactions){
                    if (transaction.reference === reference) {
                        return [transaction];
                    }
                }
        }
        return [];
    }
}

