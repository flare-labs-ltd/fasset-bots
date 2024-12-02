import axios, { AxiosError, AxiosInstance } from "axios";
import { ARBase, AddressValidity, decodeAttestationName } from "@flarenetwork/state-connector-protocol";
import { formatArgs } from "../utils/formatting";
import { ZERO_BYTES32 } from "../utils/helpers";
import { logger } from "../utils/logger";
import { IVerificationApiClient } from "./interfaces/IVerificationApiClient";
import { createAxiosConfig, tryWithClients } from "@flarelabs/simple-wallet";

export class VerificationApiError extends Error {}

interface PreparedResponseRes<T> {
    status: "VALID" | "INVALID";
    response?: T;
}

// Uses prepareResponse from private API.
export class VerificationPrivateApiClient implements IVerificationApiClient {
    verifiers: AxiosInstance [] = [];

    constructor(
        public verifierUrls: string[],
        public verifierUrlApiKeys: string[],
    ) {
        for (const [index, url] of verifierUrls.entries()) {
            this.verifiers.push(axios.create(createAxiosConfig(url, verifierUrlApiKeys[index])));
        }
    }

    async checkAddressValidity(chainId: string, addressStr: string): Promise<AddressValidity.ResponseBody> {
        const request: AddressValidity.Request = {
            attestationType: AddressValidity.TYPE,
            sourceId: chainId,
            messageIntegrityCode: ZERO_BYTES32,
            requestBody: { addressStr },
        };
        const response = await this.prepareResponse<AddressValidity.Response>(request);
        /* istanbul ignore next */
        if (response.response == null) {
            throw new VerificationApiError(`Invalid request ${formatArgs(request)}`);
        }
        return response.response.responseBody;
    }

    async prepareResponse<T>(request: ARBase): Promise<PreparedResponseRes<T>> {
        const attestationName = decodeAttestationName(request.attestationType);
        /* istanbul ignore next */
        const response = await tryWithClients(
            this.verifiers,
            (verifier: AxiosInstance) => verifier.post<PreparedResponseRes<T>>(`/${encodeURIComponent(attestationName)}/prepareResponse`, request),
            "prepareResponse"
        ).catch((e: AxiosError) => {
            const message = `Verification API error: cannot submit request ${formatArgs(request)}: ${e.status}: ${(e.response?.data as any)?.error}`;
            logger.error(message);
            throw new VerificationApiError(message);
        });
        return response.data;
    }
}
