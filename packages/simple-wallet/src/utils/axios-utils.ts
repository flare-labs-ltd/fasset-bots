import { logger } from "../utils/logger";
import { DriverException, UniqueConstraintViolationException, ValidationError } from "@mikro-orm/core";
import { BaseWalletConfig } from "../interfaces/IWalletTransaction";
import axios, { AxiosRequestConfig } from "axios";
import { DEFAULT_RATE_LIMIT_OPTIONS } from "../utils/constants";
import axiosRateLimit from "../axios-rate-limiter/axios-rate-limit";

export async function tryWithClients<T>(clients: any, operation: (client: any) => Promise<T>, method: string) {
    for (const [index, url] of Object.keys(clients).entries()) {
        try {
            const result = await operation(clients[url]);
            return result;
        } catch (error) {
            logger.warn(`Client ${url} - ${method} failed with: ${errorMessage(error)}`);
            const lastClient = Object.keys(clients).length - 1
            if (index === lastClient) {
                throw error;
            }
        }
    }
    throw new Error(`All clients failed.`);
}

export function isORMError(e: any) {
    return e instanceof ValidationError || e instanceof DriverException || e instanceof UniqueConstraintViolationException;
}

export function errorMessage(e: any) {
    return e instanceof Error ? `${e.name} - ${e.message}: \n ${e.stack}` : e;
}

export function createAxiosConfig(url: string, apiKey?: string, timeoutMs?: number) {
    const createAxiosConfig: AxiosRequestConfig = {
        baseURL: url,
        timeout: timeoutMs ?? DEFAULT_RATE_LIMIT_OPTIONS.timeoutMs,
        headers: {
            "Content-Type": "application/json",
        },
        validateStatus: function (status: number) {
            /* istanbul ignore next */
            return (status >= 200 && status < 300) || status == 500;
        },
    };
    if (apiKey) {
        createAxiosConfig.headers ??= {};
        createAxiosConfig.headers["X-API-KEY"] = apiKey;
    }
    return createAxiosConfig;
}

export class NotEnoughUTXOsError extends Error {
    constructor(message: string) {
        super(message);
    }
}

export class LessThanDustAmountError extends Error {
    constructor(message: string) {
        super(message);
    }
}

export class NegativeFeeError extends Error {
    constructor(message: string) {
        super(message);
    }
}

export function createAxiosInstance(createConfig: BaseWalletConfig) {
    return axiosRateLimit(axios.create(createAxiosConfig(createConfig.url, createConfig.apiTokenKey, createConfig.rateLimitOptions?.timeoutMs)), {
        ...DEFAULT_RATE_LIMIT_OPTIONS,
        ...createConfig.rateLimitOptions,
    });
}
