import { IBlockchainAPI, MempoolUTXO, UTXOTransactionResponse } from "../interfaces/IBlockchainAPI";
import { AxiosResponse } from "axios";
import { BaseWalletConfig } from "../interfaces/IWalletTransaction";
import { ChainType } from "../utils/constants";
import { createAxiosInstance, tryWithClients } from "../utils/axios-utils";
import { BlockbookAPI } from "./BlockbookAPI";
import BN from "bn.js";

export class BlockchainAPIWrapper implements IBlockchainAPI {
    blockbookClients: BlockbookAPI[] = [];
    chainType: ChainType;

    constructor(createConfig: BaseWalletConfig, chainType: ChainType) {
        for (const [index, url] of createConfig.urls.entries()) {
            const client = createAxiosInstance(url, createConfig.apiTokenKeys?.[index], createConfig.rateLimitOptions)
            this.blockbookClients.push(new BlockbookAPI(client, createConfig.em));
        }
        this.chainType = chainType;
    }

    async getAccountBalance(account: string): Promise<number | undefined> {
        return tryWithClients(this.blockbookClients, (client: IBlockchainAPI) => client.getAccountBalance(account), "getAccountBalance");
    }

    async getCurrentBlockHeight(): Promise<number> {
        return tryWithClients(this.blockbookClients, (client: IBlockchainAPI) => client.getCurrentBlockHeight(), "getCurrentBlockHeight");
    }

    async getCurrentFeeRate(blockNumber?: number): Promise<number> {
        return tryWithClients(this.blockbookClients, (client: IBlockchainAPI) => client.getCurrentFeeRate(blockNumber), "getCurrentFeeRate");
    }

    async getBlockTimeAt(blockNumber: number): Promise<BN> {
        return tryWithClients(this.blockbookClients, (client: IBlockchainAPI) => client.getBlockTimeAt(blockNumber), "getBlockTimeAt");
    }

    async getTransaction(txHash: string): Promise<UTXOTransactionResponse> {
        return tryWithClients(this.blockbookClients, (client: IBlockchainAPI) => client.getTransaction(txHash), "getTransaction");
    }

    async getUTXOScript(txHash: string, vout: number): Promise<string> {
        return tryWithClients(this.blockbookClients, (client: IBlockchainAPI) => client.getUTXOScript(txHash, vout, this.chainType), "getUTXOScript");
    }

    async getUTXOsFromMempool(address: string): Promise<MempoolUTXO[]> {
        return tryWithClients(this.blockbookClients, (client: IBlockchainAPI) => client.getUTXOsFromMempool(address, this.chainType), "getUTXOsFromMempool");
    }

    async sendTransaction(tx: string): Promise<AxiosResponse> {
        return tryWithClients(this.blockbookClients, (client: IBlockchainAPI) => client.sendTransaction(tx), "sendTransaction");
    }
}