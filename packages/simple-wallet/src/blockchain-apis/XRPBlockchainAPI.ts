import { BaseWalletConfig } from "../interfaces/IWalletTransaction";
import { AxiosInstance } from "axios";
import type { AccountInfoRequest } from "xrpl";
import { createAxiosInstance, tryWithClients } from "../utils/axios-utils";

export class XRPBlockchainAPI {
    clients: AxiosInstance[] = [];

    constructor(createConfig: BaseWalletConfig) {
        for (const [index, url] of createConfig.urls.entries()) {
            this.clients.push(createAxiosInstance(url, createConfig.apiTokenKeys?.[index], createConfig.rateLimitOptions));
        }
    }

    async getTransaction(transactionHash: string) {
        return tryWithClients(this.clients, (client: AxiosInstance) => client.post("", {
            method: "tx",
            params: [{ transaction: transactionHash }],
        }), "getTransaction");
    }

    async submitTransaction(params: SubmitTransactionRequest) {
        return tryWithClients(this.clients,(client: AxiosInstance) => client.post("", {
            method: "submit",
            params: [params],
        }), "submitTransaction");
    }

    async getAccountInfo(params: AccountInfoRequest) {
        return tryWithClients(this.clients, (client: AxiosInstance) => client.post("", {
                method: "account_info", params: [params],
            },
        ), "getAccountInfo");
    }

    async getServerInfo() {
        return tryWithClients(this.clients, (client: AxiosInstance) => client.post("", {
            method: "server_info",
            params: [],
        }), "getServerInfo");
    }
}

export interface SubmitTransactionRequest {
    tx_blob: string;
}