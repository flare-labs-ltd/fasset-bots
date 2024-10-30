import {
    ARBase, ARESBase, AddressValidity, AttestationDefinitionStore, BalanceDecreasingTransaction,
    ConfirmedBlockHeightExists, Payment, ReferencedPaymentNonexistence, decodeAttestationName
} from "@flarenetwork/state-connector-protocol";
import axios, { AxiosError, AxiosInstance, AxiosRequestConfig, AxiosResponse } from "axios";
import { IFdcHubInstance, IFdcVerificationInstance, IRelayInstance } from "../../typechain-truffle";
import { findRequiredEvent } from "../utils/events/truffle";
import { formatArgs } from "../utils/formatting";
import { DEFAULT_RETRIES, DEFAULT_TIMEOUT, ZERO_BYTES32, requireNotNull, retry, sleep } from "../utils/helpers";
import { logger } from "../utils/logger";
import { artifacts } from "../utils/web3";
import { web3DeepNormalize } from "../utils/web3normalize";
import { attestationProved } from "./AttestationHelper";
import {
    AttestationNotProved, AttestationProof, AttestationRequestId, FDC_PROTOCOL_ID,
    FlareDataConnectorClientError, IFlareDataConnectorClient, OptionalAttestationProof
} from "./interfaces/IFlareDataConnectorClient";

export interface PrepareRequestResult {
    abiEncodedRequest: string;
}

export interface ProofRequest {
    roundId: number;
    requestBytes: string;
}

export interface ApiWrapper<T> {
    status: string;
    data?: T;
    errorMessage?: string;
}

export interface VotingRoundResult<RES> {
    roundId: number;
    hash: string;
    requestBytes: string;
    request: any;
    response: RES;
    merkleProof: string[];
}

export class FlareDataConnectorClientHelper implements IFlareDataConnectorClient {
    clients: AxiosInstance[] = [];
    verifier: AxiosInstance;
    // initialized at initFlareDataConnector()
    relay!: IRelayInstance;
    fdcHub!: IFdcHubInstance;
    fdcVerification!: IFdcVerificationInstance;
    definitionStore = new AttestationDefinitionStore();

    constructor(
        public attestationProviderUrls: string[],
        public fdcVerificationAddress: string,
        public fdcHubAddress: string,
        public relayAddress: string,
        public verifierUrl: string,
        public verifierUrlApiKey: string,
        public account: string
    ) {
        for (const url of attestationProviderUrls) {
            // set clients
            this.clients.push(axios.create(this.createAxiosConfig(url, null)));
        }
        this.verifier = axios.create(this.createAxiosConfig(verifierUrl, verifierUrlApiKey));
    }

    async initFlareDataConnector(): Promise<void> {
        const IFdcHub = artifacts.require("IFdcHub");
        this.fdcHub = await IFdcHub.at(this.fdcHubAddress);
        const IRelay = artifacts.require("IRelay");
        this.relay = await IRelay.at(this.relayAddress);
        const IFdcVerification = artifacts.require("IFdcVerification");
        this.fdcVerification = await IFdcVerification.at(this.fdcVerificationAddress);
    }

    static async create(
        urls: string[],
        attestationClientAddress: string,
        fdcHubAddress: string,
        relayAddress: string,
        verifierUrl: string,
        verifierUrlApiKey: string,
        account: string
    ): Promise<FlareDataConnectorClientHelper> {
        const helper = new FlareDataConnectorClientHelper(urls, attestationClientAddress, fdcHubAddress, relayAddress, verifierUrl, verifierUrlApiKey, account);
        await helper.initFlareDataConnector();
        return helper;
    }

    async roundFinalized(round: number): Promise<boolean> {
        const merkleRoot = await this.relay.merkleRoots(FDC_PROTOCOL_ID, round);
        return merkleRoot !== ZERO_BYTES32;
    }

    async waitForRoundFinalization(round: number): Promise<void> {
        logger.info(`Flare data connector helper: waiting for round ${round} finalization`);
        let roundFinalized = false;
        while (!roundFinalized) {
            roundFinalized = await this.roundFinalized(round);
            await sleep(5000);
        }
        logger.info(`Flare data connector helper: round ${round} is finalized`);
    }

    async submitRequest(request: ARBase): Promise<AttestationRequestId> {
        logger.info(`Submitting flare data connector request: ${JSON.stringify(request)}`);
        const attReq = await retry(this.submitRequestToFlareDataConnector.bind(this), [request], DEFAULT_RETRIES);
        logger.info(`Flare data connector helper: retrieved attestation request ${formatArgs(attReq)}`);
        return attReq;
    }
    /* istanbul ignore next */
    async submitRequestToFlareDataConnector(request: ARBase): Promise<AttestationRequestId> {
        const attestationName = decodeAttestationName(request.attestationType);
        const response = await this.verifier
            .post<PrepareRequestResult>(`/${encodeURIComponent(attestationName)}/prepareRequest`, request)
            .catch((e: AxiosError) => {
                const message = `Flare data connector error: cannot submit request ${formatArgs(request)}: ${e.status}: ${(e.response?.data as any)?.error}`;
                logger.error(message);
                throw new FlareDataConnectorClientError(message);
            });
        const data = response.data?.abiEncodedRequest;
        if (data == null) {
            logger.error(`Problem in prepare request: ${JSON.stringify(response.data)} for request ${formatArgs(request)}`);
            throw new FlareDataConnectorClientError(`Cannot submit proof request`);
        }
        const txRes = await this.fdcHub.requestAttestation(data, { from: this.account });
        const requestEvent = findRequiredEvent(txRes, "AttestationRequest");
        const roundId = await this.relay.getVotingRoundId(requestEvent.blockNumber);
        return {
            round: Number(roundId),
            data: data,
        };
    }

    async obtainProof(round: number, requestData: string): Promise<OptionalAttestationProof> {
        const proof = await retry(this.obtainProofFromFlareDataConnector.bind(this), [round, requestData], DEFAULT_RETRIES);
        logger.info(`Flare data connector helper: obtained proof ${formatArgs(proof)}`);
        return proof;
    }

    async obtainProofFromFlareDataConnector(roundId: number, requestBytes: string): Promise<OptionalAttestationProof> {
        try {
            let disproved = 0;
            for (const client of this.clients) {
                const proof = await this.obtainProofFromFlareDataConnectorForClient(client, roundId, requestBytes);
                /* istanbul ignore next */
                if (proof == null) {
                    continue; // client failure
                }
                if (proof === AttestationNotProved.NOT_FINALIZED) {
                    return AttestationNotProved.NOT_FINALIZED;
                }
                if (!attestationProved(proof)) {
                    ++disproved;
                }
                return proof;
            }
            /* istanbul ignore next */
            if (disproved > 0) {
                return AttestationNotProved.DISPROVED;
            }
            throw new FlareDataConnectorClientError("There aren't any working attestation providers.");
        } catch (e) {
            logger.error(`Flare data connector error`, e);
            /* istanbul ignore next */
            throw e instanceof FlareDataConnectorClientError ? e : new FlareDataConnectorClientError(String(e));
        }
    }
    /* istanbul ignore next */
    async obtainProofFromFlareDataConnectorForClient(client: AxiosInstance, roundId: number, requestBytes: string): Promise<OptionalAttestationProof | null> {
        // check if round has been finalized
        // (it can happen that API returns proof finalized, but it is not finalized in flare data connector yet)
        const roundFinalized = await this.roundFinalized(roundId);
        if (!roundFinalized) {
            return AttestationNotProved.NOT_FINALIZED;
        }
        // get the response from api
        const request: ProofRequest = { roundId, requestBytes };
        let response: AxiosResponse<ApiWrapper<VotingRoundResult<ARESBase>>>;
        try {
            response = await client.post<ApiWrapper<VotingRoundResult<ARESBase>>>(`/api/proof/get-specific-proof`, request);
        } catch (e: any) {
            /* istanbul ignore next */
            logger.error(`Flare data connector error: ${e.response?.data?.errorMessage ?? String(e)}`);
            /* istanbul ignore next */
            return null; // network error, client probably down - skip it
        }
        const status = response.data.status;
        // is the round finalized?
        if (status === "PENDING") {
            return AttestationNotProved.NOT_FINALIZED;
        }
        // no proof from this client, probably disproved
        if (status !== "OK") {
            logger.error(`Flare data connector error: ${response.data.errorMessage}`);
            return AttestationNotProved.DISPROVED;
        }
        // obtained valid proof
        const data = requireNotNull(response.data.data);
        const proof: AttestationProof = {
            data: data.response,
            merkleProof: data.merkleProof,
        };
        const verified = await this.verifyProof(proof);
        /* istanbul ignore next */
        if (!verified) {
            logger.error(`Flare data connector error: proof does not verify!!`);
            return null; // client has invalid proofs, skip it
        }
        return proof;
    }
    /* istanbul ignore next */
    private async verifyProof(proofData: AttestationProof): Promise<boolean> {
        const normalizedProofData = web3DeepNormalize(proofData);
        switch (proofData.data.attestationType) {
            case Payment.TYPE:
                return await this.fdcVerification.verifyPayment(normalizedProofData);
            case BalanceDecreasingTransaction.TYPE:
                return await this.fdcVerification.verifyBalanceDecreasingTransaction(normalizedProofData);
            case ConfirmedBlockHeightExists.TYPE:
                return await this.fdcVerification.verifyConfirmedBlockHeightExists(normalizedProofData);
            case ReferencedPaymentNonexistence.TYPE:
                return await this.fdcVerification.verifyReferencedPaymentNonexistence(normalizedProofData);
            case AddressValidity.TYPE:
                return await this.fdcVerification.verifyAddressValidity(normalizedProofData);
            default:
                logger.error(`Flare data connector error: invalid attestation type ${proofData.data.attestationType}`);
                throw new FlareDataConnectorClientError(`Invalid attestation type ${proofData.data.attestationType}`);
        }
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
        /* istanbul ignore next */
        if (apiKey) {
            createAxiosConfig.headers ??= {};
            createAxiosConfig.headers["X-API-KEY"] = apiKey;
        }
        return createAxiosConfig;
    }
}
