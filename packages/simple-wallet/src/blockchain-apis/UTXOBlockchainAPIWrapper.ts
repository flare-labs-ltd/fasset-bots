import { BlockData, IBlockchainAPI, MempoolUTXO, MempoolUTXOMWithoutScript } from "../interfaces/IBlockchainAPI";
import { AxiosResponse } from "axios";
import { BaseWalletConfig } from "../interfaces/IWalletTransaction";
import { ChainType } from "../utils/constants";
import { createAxiosInstance, tryWithClients } from "../utils/axios-utils";
import { BlockbookAPI } from "./BlockbookAPI";

export class BlockchainAPIWrapper implements IBlockchainAPI {
    clients: BlockbookAPI[] = [];
    chainType: ChainType;

    constructor(createConfig: BaseWalletConfig, chainType: ChainType) {
        for (const [index, url] of createConfig.urls.entries()) {
            const client = createAxiosInstance(url, createConfig.apiTokenKeys?.[index], createConfig.rateLimitOptions)
            this.clients.push(new BlockbookAPI(client, createConfig.em));
        }
        this.chainType = chainType;
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