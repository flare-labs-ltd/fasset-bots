import { logger } from "../utils/logger";
import { DriverException, ValidationError } from "@mikro-orm/core";
import { RateLimitOptions } from "../interfaces/IWalletTransaction";
import { AxiosRequestConfig } from "axios";
import { excludeNullFields } from "../utils/utils";
import { ChainType, DEFAULT_RATE_LIMIT_OPTIONS, DEFAULT_RATE_LIMIT_OPTIONS_XRP } from "../utils/constants";

export async function tryWithClients<T>(clients: any, operation: (client: any) => Promise<T>, method: string) {
    for (const [index, url] of Object.keys(clients).entries()) {
        try {
            const result = await operation(clients[url]);
            return result;
        } catch (error) {
            if (index == Object.keys(clients).length - 1) {
                throw error;
            }
            logger.warn(`Client ${url} - ${method} failed with: ${errorMessage(error)}`);
        }
    }
    throw new Error(`All blockchain clients failed.`);
}

export function isORMError(e: any) {
    return e instanceof ValidationError || e instanceof DriverException;
}

export function errorMessage(e: any) {
    return e instanceof Error ? `${e.name} - ${e.message}: \n ${e.stack}` : e;
}

export function createAxiosConfig(chainType: ChainType, url: string, rateLimitOptions?: RateLimitOptions, apiTokenKey?: string) {
    const createAxiosConfig: AxiosRequestConfig = {
        baseURL: url,
        headers: excludeNullFields({
            "Content-Type": "application/json",
            "x-apikey": apiTokenKey,
        }),
        timeout: rateLimitOptions?.timeoutMs ?? getDefaultRateLimitOptions(chainType).timeoutMs,
        validateStatus: function(status: number) {
            /* istanbul ignore next */
            return (status >= 200 && status < 300) || status == 500;
        },
    };
    return createAxiosConfig;
}

function getDefaultRateLimitOptions(chainType: ChainType) {
    if (chainType === ChainType.testDOGE || chainType === ChainType.DOGE) {
        return DEFAULT_RATE_LIMIT_OPTIONS;
    } else if (chainType === ChainType.BTC || chainType === ChainType.testBTC) {
        return DEFAULT_RATE_LIMIT_OPTIONS;
    } else if (chainType === ChainType.XRP || chainType === ChainType.testXRP) {
        return DEFAULT_RATE_LIMIT_OPTIONS_XRP;
    } else {
        return DEFAULT_RATE_LIMIT_OPTIONS;
    }
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