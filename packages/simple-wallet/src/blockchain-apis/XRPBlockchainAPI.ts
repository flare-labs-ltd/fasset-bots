import { BaseWalletConfig } from "../interfaces/IWalletTransaction";
import axios, { AxiosInstance } from "axios";
import axiosRateLimit from "../axios-rate-limiter/axios-rate-limit";
import { ChainType, DEFAULT_RATE_LIMIT_OPTIONS_XRP } from "../utils/constants";
import { createAxiosConfig } from "../chain-clients/utils";
import type { AccountInfoRequest } from "xrpl";
import { tryWithClients } from "./utils";

export class XRPBlockchainAPI {
    client: AxiosInstance;
    clients: any = {};

    constructor(chainType: ChainType, createConfig: BaseWalletConfig) {

        this.client = this.createAxiosInstance(chainType, createConfig);
        this.clients[createConfig.url] = this.client;

        if (createConfig.fallbackAPIs) {
            for (const fallbackAPI of createConfig.fallbackAPIs) {
                this.clients[fallbackAPI.url] = this.createAxiosInstance(chainType, createConfig);
            }
        }
    }

    async getTransaction(transactionHash: string | undefined) {
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

    getClient() {
        return this.clients[Object.keys(this.clients)[0]];
    }

    private createAxiosInstance(chainType: ChainType, createConfig: BaseWalletConfig) {
        return axiosRateLimit(
            axios.create(
                createAxiosConfig(chainType, createConfig.url, createConfig.rateLimitOptions, createConfig.apiTokenKey, createConfig.username, createConfig.password)), {
                ...DEFAULT_RATE_LIMIT_OPTIONS_XRP,
                ...createConfig.rateLimitOptions,
            });
    }
}