import { BaseWalletConfig } from "../interfaces/IWalletTransaction";
import axios, { AxiosInstance } from "axios";
import axiosRateLimit from "../axios-rate-limiter/axios-rate-limit";
import { ChainType, DEFAULT_RATE_LIMIT_OPTIONS_XRP } from "../utils/constants";
import type { AccountInfoRequest } from "xrpl";
import { createAxiosConfig, createAxiosInstance, tryWithClients } from "../utils/axios-error-utils";

export class XRPBlockchainAPI {
    client: AxiosInstance;
    clients: any = {};

    constructor(chainType: ChainType, createConfig: BaseWalletConfig) {

        this.client = createAxiosInstance(chainType, createConfig);
        this.clients[createConfig.url] = this.client;

        if (createConfig.fallbackAPIs) {
            for (const fallbackAPI of createConfig.fallbackAPIs) {
                this.clients[fallbackAPI.url] = createAxiosInstance(chainType, createConfig);
            }
        }
    }

    async getTransaction(transactionHash: string) {
        return tryWithClients(this.clients,(client: AxiosInstance) => client.post("", {
            method: "tx",
            params: [{ transaction: transactionHash }],
        }), "getTransaction");
    }

    async submitTransaction(params: any) {
        return tryWithClients(this.clients,(client: AxiosInstance) => client.post("", {
            method: "submit",
            params: [params],
        }), "submitTransaction");
    }

    async getAccountInfo(params: AccountInfoRequest) {
        return tryWithClients(this.clients,(client: AxiosInstance) => client.post("", {
                method: "account_info", params: [params],
            },
        ), "getAccountInfo");
    }

    async getServerInfo() {
        return tryWithClients(this.clients,(client: AxiosInstance) => client.post("", {
            method: "server_info",
            params: [],
        }), "getServerInfo");
    }
}