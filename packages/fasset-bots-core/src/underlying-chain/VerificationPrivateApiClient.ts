import axios, { AxiosError, AxiosInstance, AxiosRequestConfig } from "axios";
import { ARBase, AddressValidity, decodeAttestationName } from "@flarenetwork/state-connector-protocol";
import { formatArgs } from "../utils/formatting";
import { DEFAULT_TIMEOUT } from "../utils/helpers";
import { logger } from "../utils/logger";
import { IVerificationApiClient } from "./interfaces/IVerificationApiClient";

export class VerificationApiError extends Error {}

interface PreparedResponseRes<T> {
    status: "VALID" | "INVALID";
    response?: T;
}

// Uses prepareResponse from private API.
// TODO: for frontend we will need a public API (unless authenticated API keeps prepareResponse).
export class VerificationPrivateApiClient implements IVerificationApiClient {
    verifier: AxiosInstance;

    constructor(
        public verifierUrl: string,
        public verifierUrlApiKey: string,
    ) {
        this.verifier = axios.create(this.createAxiosConfig(verifierUrl, verifierUrlApiKey));
    }

    async checkAddressValidity(chainId: string, addressStr: string): Promise<AddressValidity.ResponseBody> {
        const request: AddressValidity.RequestNoMic = {
            attestationType: AddressValidity.TYPE,
            sourceId: chainId,
            requestBody: { addressStr },
        };
        const response = await this.prepareResponse<AddressValidity.Response>(request);
        if (response.response == null) {
            throw new VerificationApiError(`Invalid request ${formatArgs(request)}`);
        }
        return response.response.responseBody;
    }

    async prepareResponse<T>(request: ARBase): Promise<PreparedResponseRes<T>> {
        const attestationName = decodeAttestationName(request.attestationType);
        /* istanbul ignore next */
        const response = await this.verifier
            .post<PreparedResponseRes<T>>(`/${encodeURIComponent(attestationName)}/prepareResponse`, request)
            .catch((e: AxiosError) => {
                const message = `Verification API error: cannot submit request ${formatArgs(request)}: ${e.status}: ${(e.response?.data as any)?.error}`;
                logger.error(message);
                throw new VerificationApiError(message);
            });
        return response.data;
    }

    private createAxiosConfig(url: string, apiKey: string | null): AxiosRequestConfig {
        const createAxiosConfig: AxiosRequestConfig = {
            baseURL: url,
            timeout: DEFAULT_TIMEOUT,
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
}
