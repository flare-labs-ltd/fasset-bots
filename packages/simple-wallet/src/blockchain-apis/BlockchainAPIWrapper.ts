import { IBlockchainAPI, MempoolUTXO, MempoolUTXOMWithoutScript } from "../interfaces/IBlockchainAPI";
import { AxiosInstance, AxiosResponse } from "axios";
import { BitcoreAPI } from "./BitcoreAPI";
import { BlockbookAPI } from "./BlockbookAPI";
import { createAxiosConfig } from "../chain-clients/utils";
import { BaseWalletConfig } from "../interfaces/IWalletTransaction";
import { logger } from "../utils/logger";

export class BlockchainAPIWrapper implements IBlockchainAPI {
    client: AxiosInstance;
    clients: any = {};

    constructor(createConfig: BaseWalletConfig) {
        const axiosConfig = createAxiosConfig(createConfig.url, createConfig.rateLimitOptions, createConfig.apiTokenKey, createConfig.username, createConfig.password);

        this.clients[createConfig.url] = (createConfig.api === "bitcore" ? new BitcoreAPI(axiosConfig, createConfig.rateLimitOptions) : new BlockbookAPI(axiosConfig, createConfig.rateLimitOptions, createConfig.em));;
        this.client = this.clients[createConfig.url].client;

        if (createConfig.fallbackAPIs) {
            for (const fallbackAPI of createConfig.fallbackAPIs) {
                const axiosConfig = createAxiosConfig(fallbackAPI.url, createConfig.rateLimitOptions, fallbackAPI.apiTokenKey, fallbackAPI.username, fallbackAPI.password);
                this.clients[fallbackAPI.url] = (fallbackAPI.type === "bitcore" ? new BitcoreAPI(axiosConfig, createConfig.rateLimitOptions) : new BlockbookAPI(axiosConfig, createConfig.rateLimitOptions, createConfig.em));

            }
        }
    }

    async getAccountBalance(account: string): Promise<number | undefined> {
        return this.tryWithClients((client: IBlockchainAPI) => client.getAccountBalance(account));
    }

    async getCurrentBlockHeight(): Promise<number> {
        return this.tryWithClients((client: IBlockchainAPI) => client.getCurrentBlockHeight());
    }

    async getCurrentFeeRate(nextBlocks: number): Promise<number> {
        return this.tryWithClients((client: IBlockchainAPI) => client.getCurrentFeeRate(nextBlocks));
    }

    async getTransaction(txHash: string | undefined): Promise<AxiosResponse> {
        return this.tryWithClients((client: IBlockchainAPI) => client.getTransaction(txHash));
    }

    async getUTXOScript(address: string, txHash: string, vout: number): Promise<string> {
        return this.tryWithClients((client: IBlockchainAPI) => client.getUTXOScript(address, txHash, vout));
    }

    async getUTXOsFromMempool(address: string): Promise<MempoolUTXO[]> {
        return this.tryWithClients((client: IBlockchainAPI) => client.getUTXOsFromMempool(address,));
    }

    async getUTXOsWithoutScriptFromMempool(address: string): Promise<MempoolUTXOMWithoutScript[]> {
        return this.tryWithClients((client: IBlockchainAPI) => client.getUTXOsWithoutScriptFromMempool(address));
    }

    async sendTransaction(tx: string): Promise<AxiosResponse> {
        return this.tryWithClients((client: IBlockchainAPI) => client.sendTransaction(tx));
    }

    private async tryWithClients<T>(operation: (client: any) => Promise<T>): Promise<T> {
        for (const url of Object.keys(this.clients)) {
            try {
                const result = await operation(this.clients[url]);
                return result;
            } catch (error) {
                logger.warn(`Client with ${url} failed: ${error}`);
            }
        }
        throw new Error("All clients failed to fetch data.");
    }
}