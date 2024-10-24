import { BaseWalletConfig } from "../interfaces/IWalletTransaction";
import { AxiosInstance, AxiosResponse } from "axios";
import type { AccountInfoRequest, AccountInfoResponse, ServerInfoResponse, SubmitResponse, TxResponse } from "xrpl";
import { createAxiosInstance, tryWithClients } from "../utils/axios-utils";

export class XRPBlockchainAPI {
    clients: AxiosInstance[] = [];

    constructor(createConfig: BaseWalletConfig) {
        for (const [index, url] of createConfig.urls.entries()) {
            this.clients.push(createAxiosInstance(url, createConfig.apiTokenKeys?.[index], createConfig.rateLimitOptions));
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