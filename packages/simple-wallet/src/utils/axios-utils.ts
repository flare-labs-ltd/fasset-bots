import { logger } from "../utils/logger";
import { DriverException, UniqueConstraintViolationException, ValidationError } from "@mikro-orm/core";
import { RateLimitOptions } from "../interfaces/IWalletTransaction";
import axios, { AxiosInstance, AxiosRequestConfig } from "axios";
import { DEFAULT_RATE_LIMIT_OPTIONS } from "../utils/constants";
import axiosRateLimit from "../axios-rate-limiter/axios-rate-limit";

export async function tryWithClients<T>(clients: AxiosInstance[], operation: (client: AxiosInstance) => Promise<T>, method: string) {
    for (const [index] of clients.entries()) {
        try {
            const result = await operation(clients[index]);
            return result;
        } catch (error) {
            const failedUrl = clients[index].defaults.baseURL || 'Unknown URL';
            logger.warn(`Client with index ${index}, url ${failedUrl} and method ${method} failed with: ${errorMessage(error)}`);
            const lastClient = clients.length - 1;
            if (index === lastClient) {
                throw error;
            }
        }
    }
    throw new Error(`All clients failed.`);
}

export function isORMError(e: unknown) {
    return e instanceof ValidationError || e instanceof DriverException || e instanceof UniqueConstraintViolationException;
}

export function errorMessage(e: unknown) {
    return e instanceof Error ? `${e.name} - ${e.message}: \n ${e.stack}` : String(e);
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

export function createAxiosInstance(url: string, apiKey?: string, rateLimitOptions?: RateLimitOptions) {
    return axiosRateLimit(axios.create(createAxiosConfig(url, apiKey, rateLimitOptions?.timeoutMs)), {
        ...DEFAULT_RATE_LIMIT_OPTIONS,
        ...rateLimitOptions,
    });
}
