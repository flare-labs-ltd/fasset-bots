import {
    ARBase, ARESBase, AddressValidity, AttestationDefinitionStore, BalanceDecreasingTransaction,
    ConfirmedBlockHeightExists, Payment, ReferencedPaymentNonexistence, decodeAttestationName
} from "@flarenetwork/state-connector-protocol";
import axios, { AxiosError, AxiosInstance, AxiosResponse } from "axios";
import { IFdcHubInstance, IFdcRequestFeeConfigurationsInstance, IFdcVerificationInstance, IRelayInstance } from "../../typechain-truffle";
import { findRequiredEvent } from "../utils/events/truffle";
import { formatArgs } from "../utils/formatting";
import { DEFAULT_RETRIES, ZERO_BYTES32, retry, retryCall, sleep } from "../utils/helpers";
import { logger } from "../utils/logger";
import { artifacts } from "../utils/web3";
import { web3DeepNormalize } from "../utils/web3normalize";
import { attestationProved } from "./AttestationHelper";
import {
    AttestationNotProved, AttestationProof, AttestationRequestId, FDC_PROTOCOL_ID,
    FlareDataConnectorClientError, IFlareDataConnectorClient, OptionalAttestationProof
} from "./interfaces/IFlareDataConnectorClient";
import { blockTimestamp } from "../utils/web3helpers";
import { createAxiosConfig, tryWithClients } from "@flarelabs/simple-wallet";
import { FspStatusResult } from "../utils/data-access-layer-types";

export interface PrepareRequestResult {
    abiEncodedRequest: string;
}

export interface ProofRequest {
    votingRoundId: number;
    requestBytes: string;
}

export interface VotingRoundResult<RES> {
    response: RES;
    proof: string[];
}

export class FlareDataConnectorClientHelper implements IFlareDataConnectorClient {
    dataAccessLayerClients: AxiosInstance[] = [];
    verifierClients: AxiosInstance[] = [];
    // initialized at initFlareDataConnector()
    relay!: IRelayInstance;
    fdcHub!: IFdcHubInstance;
    fdcRequestFeeConfigurations!: IFdcRequestFeeConfigurationsInstance;
    fdcVerification!: IFdcVerificationInstance;
    definitionStore = new AttestationDefinitionStore();

    constructor(
        public dataAccessLayerUrls: string[],
        public dataAccessLayerApiKeys: string[],
        public fdcVerificationAddress: string,
        public fdcHubAddress: string,
        public relayAddress: string,
        public verifierUrls: string[],
        public verifierUrlApiKeys: string[],
        public account: string,
    ) {
        for (const [index, url] of dataAccessLayerUrls.entries()) {
            this.dataAccessLayerClients.push(axios.create(createAxiosConfig(url, dataAccessLayerApiKeys[index])));
        }
        for (const [index, url] of verifierUrls.entries()) {
            this.verifierClients.push(axios.create(createAxiosConfig(url, verifierUrlApiKeys[index])));
        }
    }

    async initFlareDataConnector(): Promise<void> {
        const IFdcHub = artifacts.require("IFdcHub");
        this.fdcHub = await IFdcHub.at(this.fdcHubAddress);
        const IFdcRequestFeeConfigurations = artifacts.require("IFdcRequestFeeConfigurations");
        const fdcRequestFeeConfigurationsAddress = await this.fdcHub.fdcRequestFeeConfigurations();
        this.fdcRequestFeeConfigurations = await IFdcRequestFeeConfigurations.at(fdcRequestFeeConfigurationsAddress);
        const IRelay = artifacts.require("IRelay");
        this.relay = await IRelay.at(this.relayAddress);
        const IFdcVerification = artifacts.require("IFdcVerification");
        this.fdcVerification = await IFdcVerification.at(this.fdcVerificationAddress);
    }

    static async create(
        dataAccessLayerUrls: string[],
        dataAccessLayerApiKeys: string[],
        attestationClientAddress: string,
        fdcHubAddress: string,
        relayAddress: string,
        verifierUrls: string[],
        verifierUrlApiKeys: string[],
        account: string
    ): Promise<FlareDataConnectorClientHelper> {
        const helper = new FlareDataConnectorClientHelper(dataAccessLayerUrls, dataAccessLayerApiKeys, attestationClientAddress, fdcHubAddress, relayAddress, verifierUrls, verifierUrlApiKeys, account);
        await helper.initFlareDataConnector();
        return helper;
    }

    async roundFinalized(round: number): Promise<boolean> {
        const latestRound = await this.latestFinalizedRound();
        return round <= latestRound;
    }

    private async roundFinalizedOnChain(round: number): Promise<boolean> {
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
        const requestInfo = `${decodeAttestationName(request.attestationType)} on ${decodeAttestationName(request.sourceId)}`;
        logger.info(`Submitting flare data connector request (${requestInfo}): ${JSON.stringify(request)}`);
        const attReq = await retry(this.submitRequestToFlareDataConnector.bind(this), [request], DEFAULT_RETRIES);
        logger.info(`Flare data connector helper (${requestInfo}): retrieved attestation request ${formatArgs(attReq)}`);
        return attReq;
    }

    /* istanbul ignore next */
    async submitRequestToFlareDataConnector(request: ARBase): Promise<AttestationRequestId> {
        const attestationName = decodeAttestationName(request.attestationType);
        const response = await tryWithClients(
            this.verifierClients,
            (verifier: AxiosInstance) => verifier.post<PrepareRequestResult>(`/${encodeURIComponent(attestationName)}/prepareRequest`, request),
            "submitRequestToFlareDataConnector"
        ).catch((e: AxiosError) => {
            const message = `Flare data connector error: cannot submit request ${formatArgs(request)}: ${e.status}: ${(e.response?.data as any)?.error}`;
            logger.error(message);
            throw new FlareDataConnectorClientError(message);
        });
        const data = response.data?.abiEncodedRequest;
        if (data == null) {
            logger.error(`Problem in prepare request: ${JSON.stringify(response.data)} for request ${formatArgs(request)}`);
            throw new FlareDataConnectorClientError(`Cannot submit proof request`);
        }
        const requestFee = await this.fdcRequestFeeConfigurations.getRequestFee(data);
        const txRes = await this.fdcHub.requestAttestation(data, { from: this.account, value: requestFee });
        const requestEvent = findRequiredEvent(txRes, "AttestationRequest");
        const requestTimestamp = await blockTimestamp(requestEvent.blockNumber);
        const roundId = await this.relay.getVotingRoundId(requestTimestamp);
        return {
            round: Number(roundId),
            data: data,
        };
    }

    async latestFinalizedRound(): Promise<number> {
        const latestRound = await this.latestFinalizedRoundOnDAL();
        const finalized = await this.roundFinalizedOnChain(latestRound);
        // since in FDC rounds can be skipped and never finalized, we assume the finalization time for round has
        // passed when the DAL has info that next round was already finalized
        return finalized ? latestRound : latestRound - 1;
    }

    async latestFinalizedRoundOnDAL(): Promise<number> {
        let latestRound = -1;
        for (const client of this.dataAccessLayerClients) {
            try {
                const clientLatest = await this.latestFinalizedRoundOnClient(client);
                latestRound = Math.max(latestRound, clientLatest);
            } catch (error) {
                logger.error(`Cannot obtain latest round from data access layer client ${client.getUri()}: ${error}`);
            }
        }
        if (latestRound < 0) {
            throw new Error(`No data access layer clients available for obtaining latest round`);
        }
        return latestRound;
    }

    async latestFinalizedRoundOnClient(client: AxiosInstance): Promise<number> {
        const response = await retryCall("latestRoundOnClient", () => client.get<FspStatusResult>(`/api/v0/fsp/status`));
        return Number(response.data.latest_fdc.voting_round_id);
    }

    async obtainProof(round: number, requestData: string): Promise<OptionalAttestationProof> {
        const proof = await retry(this.obtainProofFromFlareDataConnector.bind(this), [round, requestData], DEFAULT_RETRIES);
        logger.info(`Flare data connector helper: obtained proof ${JSON.stringify(proof)}`);
        return proof;
    }

    async obtainProofFromFlareDataConnector(roundId: number, requestBytes: string): Promise<OptionalAttestationProof> {
        try {
            // check if round has been finalized
            // (it can happen that API returns proof finalized, but it is not finalized in flare data connector yet)
            const roundFinalized = await this.roundFinalized(roundId);
            if (!roundFinalized) {
                return AttestationNotProved.NOT_FINALIZED;
            }
            // obtain proof
            let disproved = 0;
            for (const client of this.dataAccessLayerClients) {
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
            /* istanbul ignore next */
            throw e instanceof FlareDataConnectorClientError ? e : new FlareDataConnectorClientError(String(e));
        }
    }

    /* istanbul ignore next */
    async obtainProofFromFlareDataConnectorForClient(client: AxiosInstance, roundId: number, requestBytes: string): Promise<OptionalAttestationProof | null> {
        // does the client have info about this round yet?
        const latestRound = await this.latestFinalizedRoundOnClient(client).catch(() => 0);
        if (latestRound < roundId) {
            logger.info(`Client ${client.getUri()} does not yet have data for round ${roundId} (latest=${latestRound})`);
            return null;
        }
        // get response
        let response: AxiosResponse<VotingRoundResult<ARESBase>>;
        try {
            const request: ProofRequest = { votingRoundId: roundId, requestBytes: requestBytes };
            response = await client.post<VotingRoundResult<ARESBase>>(`/api/v0/fdc/get-proof-round-id-bytes`, request);
        } catch (error) {
            if (error instanceof AxiosError) {
                if (error.status === 400) {
                    logger.error(`Flare data connector request not proved: ${error.response?.data?.error}`);
                    return AttestationNotProved.DISPROVED;
                }
                logger.error(`Flare data connector error (status=${error.status}, message="${error.response?.data?.error}"):`, error);
            } else {
                logger.error(`Flare data connector unknown error:`, error);
            }
            return null; // network error, client probably down - skip it
        }
        // verify that valid proof was obtained
        const proof: AttestationProof = {
            data: response.data.response,
            merkleProof: response.data.proof,
        };
        const verified = await this.verifyProof(proof)
            .catch(e => {
                logger.error(`Error verifying proof: ${e}`);
            });
        /* istanbul ignore next */
        if (!verified) {
            logger.error(`Flare data connector error: proof does not verify on ${client.getUri()}! Round=${roundId} request=${requestBytes} proof=${JSON.stringify(proof)}.`);
            return null; // since the round is finalized, the client apparently has invalid proof - skip it
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
                return false;
        }
    }
}
