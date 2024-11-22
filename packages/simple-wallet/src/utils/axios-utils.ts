import { logger } from "../utils/logger";
import { DriverException, UniqueConstraintViolationException, ValidationError } from "@mikro-orm/core";
import { RateLimitOptions } from "../interfaces/IWalletTransaction";
import axios, { AxiosInstance, AxiosRequestConfig } from "axios";
import { DEFAULT_RATE_LIMIT_OPTIONS } from "../utils/constants";
import axiosRateLimit from "../axios-rate-limiter/axios-rate-limit";
import { AxiosError } from "axios";
import { fullStackTrace, sleepMs, updateErrorWithFullStackTrace } from "./utils";

export async function tryWithClients<T>(clients: AxiosInstance[], operation: (client: AxiosInstance) => Promise<T>, method: string) {
    for (const [index] of clients.entries()) {
        try {
            const result = await operation(clients[index]);
            return result;
        } catch (error) {
            const failedUrl = clients[index].defaults.baseURL ?? 'Unknown URL';
            logger.warn(`Client with index ${index}, url ${failedUrl} and method ${method} failed with: ${errorMessage(error)}`);
            const lastClient = clients.length - 1;
            if (index === lastClient) {
                throw updateErrorWithFullStackTrace(error);
            }
        }
    }
    throw new Error(`All clients failed.`);
}

export function isORMError(e: unknown) {
    return e instanceof ValidationError || e instanceof DriverException || e instanceof UniqueConstraintViolationException;
}

export function errorMessage(e: unknown) {
    if (e instanceof AxiosError) {
        const { code, config, response } = e;
        const statusCode = response?.status ?? 'No Status';
        const statusText = response?.statusText ?? 'No Status Text';
        const url = config?.url ?? 'No URL';
        let responseData = 'No Response Data';
        if (response?.data) {
            if (typeof response.data === 'string') {
                responseData = response.data;
            } else if (typeof response.data === 'object') {
                responseData = JSON.stringify(response.data, null, 2);
            }
        }
        return `AxiosError - Code: ${code}, URL: ${url}, Status: ${statusCode} ${statusText} - ${e.message}\nResponse Data: ${responseData}\nStack Trace: ${fullStackTrace(e, 1)}`;
    } else if (e instanceof Error) {
        return `${e.name} - ${e.message}\nStack Trace: ${fullStackTrace(e, 1)}`;
    } else {
        return `Unkown error - ${String(e)}\nStack Trace: ${new Error(String(e)).stack}`;
    }
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
        createAxiosConfig.headers["x-apikey"] = apiKey;
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

export async function withRetry<T>(
    fn: () => Promise<T>,
    retryLimit = 3,
    sleepTimeMs = 5000,
    actionDescription = "action"
): Promise<T | null> {
    let attempts = 0;
    while (attempts < retryLimit) {
        try {
            const result = await fn();
            if (result != null) {
                return result;
            }
            logger.warn(`Failed to complete ${actionDescription} (received null result) on attempt ${attempts + 1}`);
        } catch (error) /* istanbul ignore next */ {
            logger.warn(`Error during ${actionDescription} on attempt ${attempts + 1}: ${errorMessage(error)}`);
        }
        attempts++;
        if (attempts < retryLimit) await sleepMs(sleepTimeMs);
    }
    logger.error(`Failed to complete ${actionDescription} after ${retryLimit} attempts.`);
    return null;
}
