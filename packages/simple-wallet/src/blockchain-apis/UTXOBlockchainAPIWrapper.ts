import { BlockData, IBlockchainAPI, MempoolUTXO, MempoolUTXOMWithoutScript } from "../interfaces/IBlockchainAPI";
import { AxiosInstance, AxiosResponse } from "axios";
import { BlockbookAPI } from "./BlockbookAPI";
import { BaseWalletConfig } from "../interfaces/IWalletTransaction";
import { ChainType } from "../utils/constants";
import { createAxiosConfig, tryWithClients } from "../utils/axios-utils";

export class BlockchainAPIWrapper implements IBlockchainAPI {
    client: AxiosInstance;
    clients: any = {};
    chainType: ChainType;

    constructor(createConfig: BaseWalletConfig, chainType: ChainType) {
        const axiosConfig = createAxiosConfig(createConfig.url, createConfig.apiTokenKey, createConfig.rateLimitOptions?.timeoutMs);

        this.chainType = chainType;
        this.clients[createConfig.url] = new BlockbookAPI(axiosConfig, createConfig.rateLimitOptions, createConfig.em);
        this.client = this.clients[createConfig.url].client;

        if (createConfig.fallbackAPIs) {
            for (const fallbackAPI of createConfig.fallbackAPIs) {
                const axiosConfig = createAxiosConfig(fallbackAPI.url, fallbackAPI.apiTokenKey, createConfig.rateLimitOptions?.timeoutMs);
                this.clients[fallbackAPI.url] = new BlockbookAPI(axiosConfig, createConfig.rateLimitOptions, createConfig.em);
            }
        }
    }

    async getAccountBalance(account: string): Promise<number | undefined> {
        return tryWithClients(this.clients, (client: IBlockchainAPI) => client.getAccountBalance(account), "getAccountBalance");
    }

    async getCurrentBlockHeight(): Promise<BlockData> {
        return tryWithClients(this.clients, (client: IBlockchainAPI) => client.getCurrentBlockHeight(), "getCurrentBlockHeight");
    }

    async getCurrentFeeRate(nextBlocks: number): Promise<number> {
        return tryWithClients(this.clients, (client: IBlockchainAPI) => client.getCurrentFeeRate(nextBlocks), "getCurrentFeeRate");
    }

    async getTransaction(txHash: string): Promise<any> {
        return tryWithClients(this.clients, (client: IBlockchainAPI) => client.getTransaction(txHash), "getTransaction");
    }

    async getUTXOScript(address: string, txHash: string, vout: number): Promise<string> {
        return tryWithClients(this.clients, (client: IBlockchainAPI) => client.getUTXOScript(address, txHash, vout, this.chainType), "getUTXOScript");
    }

    async getUTXOsFromMempool(address: string): Promise<MempoolUTXO[]> {
        return tryWithClients(this.clients, (client: IBlockchainAPI) => client.getUTXOsFromMempool(address, this.chainType), "getUTXOsFromMempool");
    }

    async getUTXOsWithoutScriptFromMempool(address: string): Promise<MempoolUTXOMWithoutScript[]> {
        return tryWithClients(this.clients, (client: IBlockchainAPI) => client.getUTXOsWithoutScriptFromMempool(address, this.chainType), "getUTXOsWithoutScriptFromMempool");
    }

    async sendTransaction(tx: string): Promise<AxiosResponse> {
        return tryWithClients(this.clients, (client: IBlockchainAPI) => client.sendTransaction(tx), "sendTransaction");
    }
}