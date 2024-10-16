import { BaseWalletConfig } from "../interfaces/IWalletTransaction";
import { AxiosInstance, AxiosResponse } from "axios";
import { ChainType } from "../utils/constants";
import type { AccountInfoRequest, AccountInfoResponse, ServerInfoResponse, SubmitResponse, TxResponse } from "xrpl";
import { createAxiosInstance } from "../utils/axios-error-utils";
import { tryWithClients } from "../utils/utils";

export class XRPBlockchainAPI {
    client: AxiosInstance;
    clients: Record<string, AxiosInstance> = {};

    constructor(chainType: ChainType, createConfig: BaseWalletConfig) {

        this.client = createAxiosInstance(chainType, createConfig);
        this.clients[createConfig.url] = this.client;

        if (createConfig.fallbackAPIs) {
            for (const fallbackAPI of createConfig.fallbackAPIs) {
                this.clients[fallbackAPI.url] = createAxiosInstance(chainType, createConfig);
            }
        }
    }

    async getTransaction(transactionHash: string): Promise<AxiosResponse<TxResponse>> {
        return tryWithClients(this.clients,(client: AxiosInstance) => client.post("", {
            method: "tx",
            params: [{ transaction: transactionHash }],
        }), "getTransaction");
    }

    async submitTransaction(params: SubmitTransactionRequest): Promise<AxiosResponse<SubmitResponse>> {
        return tryWithClients(this.clients,(client: AxiosInstance) => client.post("", {
            method: "submit",
            params: [params],
        }), "submitTransaction");
    }

    async getAccountInfo(params: AccountInfoRequest): Promise<AxiosResponse<AccountInfoResponse>> {
        return tryWithClients(this.clients,(client: AxiosInstance) => client.post("", {
                method: "account_info", params: [params],
            },
        ), "getAccountInfo");
    }

    async getServerInfo(): Promise<AxiosResponse<ServerInfoResponse>> {
        return tryWithClients(this.clients,(client: AxiosInstance) => client.post("", {
            method: "server_info",
            params: [],
        }), "getServerInfo");
    }
}

export interface SubmitTransactionRequest {
    tx_blob: string;
}