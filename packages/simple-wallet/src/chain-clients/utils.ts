import {
    ValidationError,
    DriverException,

} from "@mikro-orm/core";
import { RateLimitOptions } from "../interfaces/IWalletTransaction";
import { AxiosRequestConfig } from "axios";
import { excludeNullFields } from "../utils/utils";
import { DEFAULT_RATE_LIMIT_OPTIONS } from "../utils/constants";

export function isORMError(e: any) {
    return e instanceof ValidationError || e instanceof DriverException;
}

export function errorMessage(e: any) {
    return e instanceof Error ? `${e.name} - ${e.message}: \n ${e.stack}` : e;
}

export function createAxiosConfig(url: string, rateLimitOptions?: RateLimitOptions, apiTokenKey?: string, username?: string, password?: string) {
    const createAxiosConfig: AxiosRequestConfig = {
        baseURL: url,
        headers: excludeNullFields({
            "Content-Type": "application/json",
            "x-apikey": apiTokenKey,
        }),
        auth:
            username && password
                ? {
                    username: username,
                    password: password,
                }
                : undefined,
        timeout: rateLimitOptions?.timeoutMs ?? DEFAULT_RATE_LIMIT_OPTIONS.timeoutMs,
        validateStatus: function(status: number) {
            /* istanbul ignore next */
            return (status >= 200 && status < 300) || status == 500;
        },
    };
    return createAxiosConfig;
}