import axios, { AxiosError, AxiosInstance, AxiosRequestConfig, AxiosResponse } from "axios";
import { ARBase, ARESBase, AddressValidity, AttestationDefinitionStore, BalanceDecreasingTransaction, ConfirmedBlockHeightExists, Payment, ReferencedPaymentNonexistence, decodeAttestationName } from "@flarenetwork/state-connector-protocol";
import { ISCProofVerifierInstance, IStateConnectorInstance } from "../../typechain-truffle";
import { requiredEventArgs } from "../utils/events/truffle";
import { formatArgs } from "../utils/formatting";
import { DEFAULT_RETRIES, DEFAULT_TIMEOUT, retry, sleep, toNumber } from "../utils/helpers";
import { logger } from "../utils/logger";
import { artifacts } from "../utils/web3";
import { web3DeepNormalize } from "../utils/web3normalize";
import { attestationProved } from "./AttestationHelper";
import { AttestationNotProved, AttestationProof, AttestationRequestId, IStateConnectorClient, OptionalAttestationProof } from "./interfaces/IStateConnectorClient";

export class StateConnectorError extends Error {
    constructor(message: string) {
        super(message);
    }
}

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

export class StateConnectorClientHelper implements IStateConnectorClient {
    clients: AxiosInstance[] = [];
    verifier: AxiosInstance;
    // initialized at initStateConnector()
    stateConnector!: IStateConnectorInstance;
    scProofVerifier!: ISCProofVerifierInstance;
    firstEpochStartTime!: number;
    roundDurationSec!: number;
    definitionStore = new AttestationDefinitionStore();

    constructor(
        public attestationProviderUrls: string[],
        public scProofVerifierAddress: string,
        public stateConnectorAddress: string,
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

    async initStateConnector(): Promise<void> {
        const IStateConnector = artifacts.require("IStateConnector");
        this.stateConnector = await IStateConnector.at(this.stateConnectorAddress);
        const ISCProofVerifier = artifacts.require("ISCProofVerifier");
        this.scProofVerifier = await ISCProofVerifier.at(this.scProofVerifierAddress);
        this.firstEpochStartTime = toNumber(await this.stateConnector.BUFFER_TIMESTAMP_OFFSET());
        this.roundDurationSec = toNumber(await this.stateConnector.BUFFER_WINDOW());
    }

    static async create(
        urls: string[],
        attestationClientAddress: string,
        stateConnectorAddress: string,
        verifierUrl: string,
        verifierUrlApiKey: string,
        account: string
    ): Promise<StateConnectorClientHelper> {
        const helper = new StateConnectorClientHelper(urls, attestationClientAddress, stateConnectorAddress, verifierUrl, verifierUrlApiKey, account);
        await helper.initStateConnector();
        return helper;
    }

    async roundFinalized(round: number): Promise<boolean> {
        const lastRound = Number(await this.stateConnector.lastFinalizedRoundId());
        if (round <= lastRound) {
            return true;
        }
        return false;
    }

    async waitForRoundFinalization(round: number): Promise<void> {
        logger.info(`State connector helper: waiting for round ${round} finalization`);
        let roundFinalized = false;
        while (!roundFinalized) {
            roundFinalized = await this.roundFinalized(round);
            await sleep(5000);
        }
        logger.info(`State connector helper: round ${round} is finalized`);
    }

    async submitRequest(request: ARBase): Promise<AttestationRequestId> {
        const attReq = await retry(this.submitRequestToStateConnector.bind(this), [request], DEFAULT_RETRIES);
        logger.info(`State connector helper: retrieved attestation request ${formatArgs(attReq)}`);
        return attReq;
    }

    async submitRequestToStateConnector(request: ARBase): Promise<AttestationRequestId> {
        const attestationName = decodeAttestationName(request.attestationType);
        /* istanbul ignore next */
        const response = await this.verifier
            .post<PrepareRequestResult>(`/${encodeURIComponent(attestationName)}/prepareRequest`, request)
            .catch((e: AxiosError) => {
                const message = `State connector error: cannot submit request ${formatArgs(request)}: ${e.status}: ${(e.response?.data as any)?.error}`;
                logger.error(message);
                throw new StateConnectorError(message);
            });
        const data = response.data.abiEncodedRequest;
        const txRes = await this.stateConnector.requestAttestations(data, { from: this.account });
        const attReq = requiredEventArgs(txRes, "AttestationRequest");
        const calculatedRoundId = this.timestampToRoundId(toNumber(attReq.timestamp));
        return {
            round: calculatedRoundId,
            data: data,
        };
    }

    timestampToRoundId(timestamp: number): number {
        // assume that initStateConnector was called before
        return Math.floor((timestamp - this.firstEpochStartTime) / this.roundDurationSec);
    }

    async obtainProof(round: number, requestData: string): Promise<OptionalAttestationProof> {
        const proof = await retry(this.obtainProofFromStateConnector.bind(this), [round, requestData], DEFAULT_RETRIES);
        logger.info(`State connector helper: obtained proof ${formatArgs(proof)}`);
        return proof;
    }

    async obtainProofFromStateConnector(roundId: number, requestBytes: string): Promise<OptionalAttestationProof> {
        try {
            let disproved = 0;
            for (const client of this.clients) {
                const proof = await this.obtainProofFromStateConnectorForClient(client, roundId, requestBytes);
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
            throw new StateConnectorError("There aren't any working attestation providers.");
        } catch (e) {
            logger.error(`State connector error`, e);
            /* istanbul ignore next */
            throw e instanceof StateConnectorError ? e : new StateConnectorError(String(e));
        }
    }

    async obtainProofFromStateConnectorForClient(client: AxiosInstance, roundId: number, requestBytes: string): Promise<OptionalAttestationProof | null> {
        const request: ProofRequest = { roundId, requestBytes };
        let response: AxiosResponse<ApiWrapper<VotingRoundResult<ARESBase>>>;
        try {
            response = await client.post<ApiWrapper<VotingRoundResult<ARESBase>>>(`/api/proof/get-specific-proof`, request);
        } catch (e: any) {
            /* istanbul ignore next */
            logger.error(`State connector error: ${e.response?.data?.errorMessage ?? String(e)}`);
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
            logger.error(`State connector error: ${response.data.errorMessage}`);
            return AttestationNotProved.DISPROVED;
        }
        // obtained valid proof
        const data = response.data.data!;
        const proof: AttestationProof = {
            data: data.response,
            merkleProof: data.merkleProof,
        };
        const verified = await this.verifyProof(proof);
        /* istanbul ignore next */
        if (!verified) {
            logger.error(`State connector error: proof does not verify!!`);
            return null; // client has invalid proofs, skip it
        }
        return proof;
    }

    private async verifyProof(proofData: AttestationProof): Promise<boolean> {
        const normalizedProofData = web3DeepNormalize(proofData);
        switch (proofData.data.attestationType) {
            case Payment.TYPE:
                return await this.scProofVerifier.verifyPayment(normalizedProofData);
            case BalanceDecreasingTransaction.TYPE:
                return await this.scProofVerifier.verifyBalanceDecreasingTransaction(normalizedProofData);
            case ConfirmedBlockHeightExists.TYPE:
                return await this.scProofVerifier.verifyConfirmedBlockHeightExists(normalizedProofData);
            case ReferencedPaymentNonexistence.TYPE:
                return await this.scProofVerifier.verifyReferencedPaymentNonexistence(normalizedProofData);
            case AddressValidity.TYPE:
                return await this.scProofVerifier.verifyAddressValidity(normalizedProofData);
            default:
                logger.error(`State connector error: invalid attestation type ${proofData.data.attestationType}`);
                throw new StateConnectorError(`Invalid attestation type ${proofData.data.attestationType}`);
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
        if (apiKey) {
            // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
            createAxiosConfig.headers!["X-API-KEY"] = apiKey;
        }
        return createAxiosConfig;
    }
}
