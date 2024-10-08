import { IBlockchainAPI, MempoolUTXO } from "../interfaces/IBlockchainAPI";
import { AxiosInstance, AxiosResponse } from "axios";
import { BlockbookAPI } from "./BlockbookAPI";
import { BaseWalletConfig } from "../interfaces/IWalletTransaction";
import { ChainType } from "../utils/constants";
import { createAxiosConfig, tryWithClients } from "../utils/axios-error-utils";
import BN from "bn.js";

export class BlockchainAPIWrapper implements IBlockchainAPI {
    client: AxiosInstance;
    clients: any = {};
    chainType: ChainType;

    constructor(createConfig: BaseWalletConfig, chainType: ChainType) {
        const axiosConfig = createAxiosConfig(chainType, createConfig.url, createConfig.rateLimitOptions, createConfig.apiTokenKey);

        this.chainType = chainType;
        this.clients[createConfig.url] = new BlockbookAPI(axiosConfig, createConfig.rateLimitOptions, createConfig.em);
        this.client = this.clients[createConfig.url].client;

        if (createConfig.fallbackAPIs) {
            for (const fallbackAPI of createConfig.fallbackAPIs) {
                const axiosConfig = createAxiosConfig(chainType, fallbackAPI.url, createConfig.rateLimitOptions, fallbackAPI.apiTokenKey);
                this.clients[fallbackAPI.url] = new BlockbookAPI(axiosConfig, createConfig.rateLimitOptions, createConfig.em);
            }
        }
    }

    async getAccountBalance(account: string): Promise<number | undefined> {
        return tryWithClients(this.clients, (client: IBlockchainAPI) => client.getAccountBalance(account), "getAccountBalance");
    }

    async getCurrentBlockHeight(): Promise<number> {
        return tryWithClients(this.clients, (client: IBlockchainAPI) => client.getCurrentBlockHeight(), "getCurrentBlockHeight");
    }

    async getCurrentFeeRate(blockNumber?: number): Promise<number> {
        return tryWithClients(this.clients, (client: IBlockchainAPI) => client.getCurrentFeeRate(blockNumber), "getCurrentFeeRate");
    }

    async getBlockTimeAt(blockNumber: number): Promise<BN> {
        return tryWithClients(this.clients, (client: IBlockchainAPI) => client.getBlockTimeAt(blockNumber), "getBlockTimeAt");
    }

    async getTransaction(txHash: string): Promise<any> {
        return tryWithClients(this.clients, (client: IBlockchainAPI) => client.getTransaction(txHash), "getTransaction");
    }

    async getUTXOScript(txHash: string, vout: number): Promise<string> {
        return tryWithClients(this.clients, (client: IBlockchainAPI) => client.getUTXOScript(txHash, vout, this.chainType), "getUTXOScript");
    }

    async getUTXOsFromMempool(address: string): Promise<MempoolUTXO[]> {
        return tryWithClients(this.clients, (client: IBlockchainAPI) => client.getUTXOsFromMempool(address, this.chainType), "getUTXOsFromMempool");
    }

    async sendTransaction(tx: string): Promise<AxiosResponse> {
        return tryWithClients(this.clients, (client: IBlockchainAPI) => client.sendTransaction(tx), "sendTransaction");
    }
}