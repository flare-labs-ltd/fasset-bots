import axios, { AxiosInstance, AxiosRequestConfig } from "axios";
import { IStateConnectorInstance, SCProofVerifierInstance } from "../../typechain-truffle";
import { requiredEventArgs } from "../utils/events/truffle";
import { BNish, DEFAULT_RETRIES, DEFAULT_TIMEOUT, retry, sleep, toBN, toNumber } from "../utils/helpers";
import { MerkleTree } from "../utils/MerkleTree";
import { web3DeepNormalize } from "../utils/web3normalize";
import {
    DHBalanceDecreasingTransaction,
    DHConfirmedBlockHeightExists,
    DHPayment,
    DHReferencedPaymentNonexistence,
    DHType,
} from "../verification/generated/attestation-hash-types";
import { AttestationType } from "../verification/generated/attestation-types-enum";
import { AttestationRequestId, AttestationResponse, IStateConnectorClient } from "./interfaces/IStateConnectorClient";
import { ARBase } from "../verification/generated/attestation-request-types";
import { StaticAttestationDefinitionStore } from "../utils/StaticAttestationDefinitionStore";
import { artifacts } from "../utils/artifacts";
import { logger } from "../utils/logger";
import { formatArgs } from "../utils/formatting";

export class StateConnectorError extends Error {
    constructor(message: string) {
        super(message);
    }
}

export class StateConnectorClientHelper implements IStateConnectorClient {
    clients: AxiosInstance[] = [];
    verifier: AxiosInstance;
    // initialized at initStateConnector()
    stateConnector!: IStateConnectorInstance;
    scProofVerifier!: SCProofVerifierInstance;
    firstEpochStartTime!: number;
    roundDurationSec!: number;
    definitionStore = new StaticAttestationDefinitionStore();

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
        const SCProofVerifier = artifacts.require("SCProofVerifier");
        this.scProofVerifier = await SCProofVerifier.at(this.scProofVerifierAddress);
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

    async submitRequest(request: ARBase): Promise<AttestationRequestId | null> {
        const attReq = await retry(this.submitRequestToStateConnector.bind(this), [request], DEFAULT_RETRIES);
        logger.info(`State connector helper: retrieved attestation request ${formatArgs(attReq)}`);
        return attReq;
    }

    async submitRequestToStateConnector(request: ARBase): Promise<AttestationRequestId | null> {
        const response = await this.verifier.post("/query/prepareAttestation", request);
        const status = response.data.status;
        const data = response.data.data;
        const errorMessage = response.data.errorMessage;
        const errorDetails = response.data.errorDetails;
        /* istanbul ignore else */
        if (status === "OK") {
            const txRes = await this.stateConnector.requestAttestations(data, { from: this.account });
            const attReq = requiredEventArgs(txRes, "AttestationRequest");
            const calculated_round_id = this.timestampToRoundId(toNumber(attReq.timestamp));
            return {
                round: calculated_round_id,
                data: data,
            };
        } else {
            logger.error(
                `State connector error: cannot submit request ${formatArgs(request)}: ${status}: ${errorMessage ? errorMessage : ""}, ${
                    errorDetails ? errorDetails : ""
                }`
            );
            throw new StateConnectorError(
                `State connector error: cannot submit request ${formatArgs(request)}: ${status}: ${errorMessage ? errorMessage : ""}, ${
                    errorDetails ? errorDetails : ""
                }`
            );
        }
    }

    timestampToRoundId(timestamp: number): number {
        // assume that initStateConnector was called before
        return Math.floor((timestamp - this.firstEpochStartTime) / this.roundDurationSec);
    }

    async obtainProof(round: number, requestData: string): Promise<AttestationResponse<DHType>> {
        const proof = await retry(this.obtainProofFromStateConnector.bind(this), [round, requestData], DEFAULT_RETRIES);
        logger.info(`State connector helper: obtained proof ${formatArgs(proof)}`);
        return proof;
    }

    async obtainProofFromStateConnector(round: number, requestData: string): Promise<AttestationResponse<DHType>> {
        try {
            for (const [i, client] of this.clients.entries()) {
                const resp = await client.get(`/api/proof/votes-for-round/${round}`);
                const status = resp.data.status;
                const data = resp.data.data;

                // is the round finalized?
                if (status !== "OK") {
                    return { finalized: false, result: null };
                }

                // find response matching requestData
                let matchedResponse: any = null;
                for (const item of data) {
                    const encoded = this.definitionStore.encodeRequest(item.request);
                    if (encoded.toUpperCase() === requestData.toUpperCase()) {
                        matchedResponse = item;
                    }
                }
                if (matchedResponse == null) {
                    // round is finalized, but this request hasn't been proved (it is false)
                    if (this.lastClient(i)) {
                        return { finalized: true, result: null };
                    } else {
                        continue;
                    }
                }

                // build Merkle tree, obtain proof, and check root
                const hashes: string[] = data.map((item: any) => item.hash) as string[];
                const tree = new MerkleTree(hashes);
                const index = tree.sortedHashes.findIndex((hash) => hash === matchedResponse.hash);
                const proof = tree.getProof(index);
                /* istanbul ignore next */
                if (proof == null) {
                    // this should never happen, unless there is bug in the MerkleTree implementation
                    logger.error(`State connector error: cannot obtain Merkle proof`);
                    throw new StateConnectorError(`Cannot obtain Merkle proof`);
                }

                // gets the root and checks that it is available (throws if it is not)
                const scFinalizedRoot = await this.stateConnector.merkleRoot(round);
                /* istanbul ignore next */
                if (scFinalizedRoot !== tree.root) {
                    // this can only happen if the attestation provider from where we picked data is
                    // inconsistent with the finalized Merkle root in the blockchain
                    // skip to next attestation provider
                    if (this.lastClient(i)) {
                        logger.error(`State connector error: SC Merkle roots mismatch ${scFinalizedRoot} != ${tree.root}`);
                        throw new StateConnectorError(`SC Merkle roots mismatch ${scFinalizedRoot} != ${tree.root}`);
                    } else {
                        continue;
                    }
                }

                // convert the proof
                const proofData = this.decodeProof(matchedResponse.response, matchedResponse.request.attestationType, proof);

                // extra verification - should never fail, since Merkle root matches
                const verified = this.verifyProof(matchedResponse.request.sourceId, matchedResponse.request.attestationType, proofData);
                /* istanbul ignore next */
                if (!verified) {
                    logger.error(`State connector error: proof does not verify!!`);
                    throw new StateConnectorError("Proof does not verify!!!");
                }

                return { finalized: true, result: proofData };
            }
            logger.error(`State connector error: there aren't any attestation providers`);
            throw new StateConnectorError("There aren't any attestation providers.");
        } catch (e) {
            if (e instanceof StateConnectorError) {
                logger.error(`State connector error: ${e}`);
                throw e;
            }
            logger.error(`State connector error: ${String(e)}`);
            throw new StateConnectorError(String(e));
        }
    }

    private async verifyProof(sourceId: BNish, type: AttestationType, proofData: DHType): Promise<boolean> {
        const normalizedProofData = web3DeepNormalize(proofData);
        switch (type) {
            case AttestationType.Payment:
                return await this.scProofVerifier.verifyPayment(sourceId, normalizedProofData as any);
            case AttestationType.BalanceDecreasingTransaction:
                return await this.scProofVerifier.verifyBalanceDecreasingTransaction(sourceId, normalizedProofData as any);
            case AttestationType.ConfirmedBlockHeightExists:
                return await this.scProofVerifier.verifyConfirmedBlockHeightExists(sourceId, normalizedProofData as any);
            case AttestationType.ReferencedPaymentNonexistence:
                return await this.scProofVerifier.verifyReferencedPaymentNonexistence(sourceId, normalizedProofData as any);
            default:
                logger.error(`State connector error: invalid attestation type ${type}`);
                throw new StateConnectorError(`Invalid attestation type ${type}`);
        }
    }

    private decodeProof(matchedResponse: any, type: AttestationType, proof: string[]): DHType {
        switch (type) {
            case AttestationType.Payment:
                return this.decodePayment(matchedResponse, proof);
            case AttestationType.BalanceDecreasingTransaction:
                return this.decodeBalanceDecreasingTransaction(matchedResponse, proof);
            case AttestationType.ConfirmedBlockHeightExists:
                return this.decodeConfirmedBlockHeightExists(matchedResponse, proof);
            case AttestationType.ReferencedPaymentNonexistence:
                return this.decodeReferencedPaymentNonexistence(matchedResponse, proof);
            default:
                logger.error(`State connector error: invalid attestation type ${type}`);
                throw new StateConnectorError(`Invalid attestation type ${type}`);
        }
    }

    private decodePayment(matchedResponse: any, proof: string[]): DHPayment {
        return {
            stateConnectorRound: matchedResponse.stateConnectorRound,
            merkleProof: proof,
            blockNumber: toBN(matchedResponse.blockNumber),
            blockTimestamp: toBN(matchedResponse.blockTimestamp),
            transactionHash: matchedResponse.transactionHash,
            inUtxo: toBN(matchedResponse.inUtxo),
            utxo: toBN(matchedResponse.utxo),
            sourceAddressHash: matchedResponse.sourceAddressHash,
            intendedSourceAddressHash: matchedResponse.intendedSourceAddressHash,
            receivingAddressHash: matchedResponse.receivingAddressHash,
            intendedReceivingAddressHash: matchedResponse.intendedReceivingAddressHash,
            spentAmount: toBN(matchedResponse.spentAmount),
            intendedSpentAmount: toBN(matchedResponse.intendedSpentAmount),
            receivedAmount: toBN(matchedResponse.receivedAmount),
            intendedReceivedAmount: toBN(matchedResponse.intendedReceivedAmount),
            paymentReference: matchedResponse.paymentReference,
            oneToOne: matchedResponse.oneToOne,
            status: toBN(matchedResponse.status),
        };
    }

    private decodeBalanceDecreasingTransaction(matchedResponse: any, proof: string[]): DHBalanceDecreasingTransaction {
        return {
            stateConnectorRound: matchedResponse.stateConnectorRound,
            merkleProof: proof,
            blockNumber: toBN(matchedResponse.blockNumber),
            blockTimestamp: toBN(matchedResponse.blockTimestamp),
            transactionHash: matchedResponse.transactionHash,
            sourceAddressIndicator: matchedResponse.sourceAddressIndicator,
            sourceAddressHash: matchedResponse.sourceAddressHash,
            spentAmount: toBN(matchedResponse.spentAmount),
            paymentReference: matchedResponse.paymentReference,
        };
    }

    private decodeConfirmedBlockHeightExists(matchedResponse: any, proof: string[]): DHConfirmedBlockHeightExists {
        return {
            stateConnectorRound: matchedResponse.stateConnectorRound,
            merkleProof: proof,
            blockNumber: toBN(matchedResponse.blockNumber),
            blockTimestamp: toBN(matchedResponse.blockTimestamp),
            numberOfConfirmations: toBN(matchedResponse.numberOfConfirmations),
            lowestQueryWindowBlockNumber: toBN(matchedResponse.lowestQueryWindowBlockNumber),
            lowestQueryWindowBlockTimestamp: toBN(matchedResponse.lowestQueryWindowBlockTimestamp),
        };
    }

    private decodeReferencedPaymentNonexistence(matchedResponse: any, proof: string[]): DHReferencedPaymentNonexistence {
        return {
            stateConnectorRound: matchedResponse.stateConnectorRound,
            merkleProof: proof,
            deadlineBlockNumber: toBN(matchedResponse.deadlineBlockNumber),
            deadlineTimestamp: toBN(matchedResponse.deadlineTimestamp),
            destinationAddressHash: matchedResponse.destinationAddressHash,
            paymentReference: matchedResponse.paymentReference,
            amount: toBN(matchedResponse.amount),
            lowerBoundaryBlockNumber: toBN(matchedResponse.lowerBoundaryBlockNumber),
            lowerBoundaryBlockTimestamp: toBN(matchedResponse.lowerBoundaryBlockTimestamp),
            firstOverflowBlockNumber: toBN(matchedResponse.firstOverflowBlockNumber),
            firstOverflowBlockTimestamp: toBN(matchedResponse.firstOverflowBlockTimestamp),
        };
    }

    private lastClient(i: number): boolean {
        return i === this.clients.length - 1;
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
