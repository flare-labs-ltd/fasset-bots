import { BaseWalletConfig } from "../interfaces/IWalletTransaction";
import axios, { AxiosInstance } from "axios";
import axiosRateLimit from "../axios-rate-limiter/axios-rate-limit";
import { ChainType, DEFAULT_RATE_LIMIT_OPTIONS_XRP } from "../utils/constants";
import { createAxiosConfig } from "../chain-clients/utils";
import { logger } from "../utils/logger";
import type { AccountInfoRequest } from "xrpl";

export class XRPBlockchainAPI {
    clients: any = {};

    constructor(chainType: ChainType, createConfig: BaseWalletConfig) {

        this.clients[createConfig.url] = axiosRateLimit(
            axios.create(
                createAxiosConfig(chainType, createConfig.url, createConfig.rateLimitOptions, createConfig.apiTokenKey, createConfig.username, createConfig.password)), {
                ...DEFAULT_RATE_LIMIT_OPTIONS_XRP,
                ...createConfig.rateLimitOptions,
            });

        if (createConfig.fallbackAPIs) {
            for (const fallbackAPI of createConfig.fallbackAPIs) {
                this.clients[fallbackAPI.url] = axiosRateLimit(
                    axios.create(createAxiosConfig(chainType, createConfig.url, createConfig.rateLimitOptions, createConfig.apiTokenKey, createConfig.username, createConfig.password)), {
                        ...DEFAULT_RATE_LIMIT_OPTIONS_XRP,
                        ...createConfig.rateLimitOptions,
                    });
            }
        }
    }

    async getTransaction(transactionHash: string | undefined) {
        return this.tryWithClients(client=> client.post("", {
            method: "tx",
            params: [{ transaction: transactionHash }],
        }));
    }

    async submitTransaction(params: any) {
        return this.tryWithClients(client => client.post("", {
            method: "submit",
            params: [params],
        }));
    }

    async getAccountInfo(params: AccountInfoRequest) {
        return this.tryWithClients(client => client.post("", {
                method: "account_info", params: [params],
            },
        ));
    }

    async getServerInfo() {
        return this.tryWithClients(client => client.post("", {
            method: "server_info",
            params: [],
        }));
    }

    private async tryWithClients<T>(operation: (client: AxiosInstance) => Promise<T>): Promise<T> {
        for (const url of Object.keys(this.clients)) {
            try {
                return await operation(this.clients[url]);
            } catch (error) {
                logger.warn(`Client ${url} failed with: ${error}`);
            }
        }
        throw new Error("All clients failed to fetch data.");
    }
}