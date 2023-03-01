import axios, { AxiosInstance, AxiosRequestConfig } from "axios";
import { AttestationClientSCInstance, IStateConnectorInstance } from "../../typechain-truffle";
import { requiredEventArgs } from "../utils/events/truffle";
import { BNish, sleep, toBN, toNumber } from "../utils/helpers";
import { MerkleTree } from "../utils/MerkleTree";
import { web3DeepNormalize } from "../utils/web3normalize";
import { DHBalanceDecreasingTransaction, DHConfirmedBlockHeightExists, DHPayment, DHReferencedPaymentNonexistence, DHType } from "../verification/generated/attestation-hash-types";
import { encodeRequest } from "../verification/generated/attestation-request-encode";
import { AttestationType } from "../verification/generated/attestation-types-enum";
import { AttestationRequest, AttestationResponse, IStateConnectorClient } from "./interfaces/IStateConnectorClient";

const DEFAULT_TIMEOUT = 15000;

export class StateConnectorError extends Error {
    constructor(message: string) {
        super(message);
    }
}

export class StateConnectorClientHelper implements IStateConnectorClient {

    clients: AxiosInstance[] = [];

    // initialized at initStateConnector()
    stateConnector!: IStateConnectorInstance;
    attestationClient!: AttestationClientSCInstance;
    firstEpochStartTime!: number;
    roundDurationSec!: number;

    constructor(
        public artifacts: Truffle.Artifacts,
        public attestationProviderUrls: string[],
        public attestationClientAddress: string,
        public stateConnectorAddress: string,
        public account: string
    ) {
        for (const url of attestationProviderUrls) {
            const createAxiosConfig: AxiosRequestConfig = {
                baseURL: url,
                timeout: DEFAULT_TIMEOUT,
                headers: { "Content-Type": "application/json" },
                validateStatus: function (status: number) {
                    return (status >= 200 && status < 300) || status == 500;
                },
            };
            // set clients
            this.clients.push(axios.create(createAxiosConfig));
        }
    }

    async initStateConnector(): Promise<void> {
        const IStateConnector = this.artifacts.require("IStateConnector");
        this.stateConnector = await IStateConnector.at(this.stateConnectorAddress);
        const AttestationClientSC = this.artifacts.require("AttestationClientSC");
        this.attestationClient = await AttestationClientSC.at(this.attestationClientAddress);
        this.firstEpochStartTime = toNumber(await this.stateConnector.BUFFER_TIMESTAMP_OFFSET());
        this.roundDurationSec = toNumber(await this.stateConnector.BUFFER_WINDOW());
    }

    static async create(artifacts: Truffle.Artifacts, urls: string[], attestationClientAddress: string, stateConnectorAddress: string, account: string): Promise<StateConnectorClientHelper> {
        const helper = new StateConnectorClientHelper(artifacts, urls, attestationClientAddress, stateConnectorAddress, account);
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
        let roundFinalized = false;
        while (!roundFinalized) {
            roundFinalized = await this.roundFinalized(round);
            await sleep(5000);
        }
    }

    async submitRequest(data: string): Promise<AttestationRequest> {
        const txRes = await this.stateConnector.requestAttestations(data, { from: this.account });
        const attReq = requiredEventArgs(txRes, 'AttestationRequest');
        const calculated_round_id = this.timestampToRoundId(toNumber(attReq.timestamp));
        return {
            round: calculated_round_id,
            data: data
        }
    }

    timestampToRoundId(timestamp: number): number {
        // assume that initStateConnector was called before
        return Math.floor((timestamp - this.firstEpochStartTime) / this.roundDurationSec);
    }

    async obtainProof(round: number, requestData: string): Promise<AttestationResponse<DHType>> {
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
                for (let item of data) {
                    let encoded = encodeRequest(item.request);
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
                if (proof == null) {
                    // this should never happen, unless there is bug in the MerkleTree implementation
                    throw new StateConnectorError(`Cannot obtain Merkle proof`);
                }

                // gets the root and checks that it is available (throws if it is not)
                const scFinalizedRoot = await this.stateConnector.merkleRoot(round);
                if (scFinalizedRoot !== tree.root) {
                    // this can only happen if the attestation provider from where we picked data is
                    // inconsistent with the finalized Merkle root in the blockchain
                    // skip to next attestation provider
                    if (this.lastClient(i)) {
                        throw new StateConnectorError(`SC Merkle roots mismatch ${scFinalizedRoot} != ${tree.root}`);
                    } else {
                        continue;
                    }
                }

                // convert the proof
                const proofData = this.decodeProof(matchedResponse.response, matchedResponse.request.attestationType, proof);

                // extra verification - should never fail, since Merkle root matches
                const verified = this.verifyProof(matchedResponse.request.sourceId, matchedResponse.request.attestationType, proofData);
                if (!verified) {
                    throw new StateConnectorError("Proof does not verify!!!")
                }

                return { finalized: true, result: proofData };
            }
            throw new StateConnectorError("There aren't any attestation providers.")
        } catch (e) {
            if (e instanceof StateConnectorError) throw e;
            throw new StateConnectorError(String(e));
        }
    }

    private async verifyProof(sourceId: BNish, type: AttestationType, proofData: DHType): Promise<boolean> {
        const normalizedProofData = web3DeepNormalize(proofData);
        switch (type) {
            case AttestationType.Payment:
                return await this.attestationClient.verifyPayment(sourceId, normalizedProofData as any);
            case AttestationType.BalanceDecreasingTransaction:
                return await this.attestationClient.verifyBalanceDecreasingTransaction(sourceId, normalizedProofData as any);
            case AttestationType.ConfirmedBlockHeightExists:
                return await this.attestationClient.verifyConfirmedBlockHeightExists(sourceId, normalizedProofData as any);
            case AttestationType.ReferencedPaymentNonexistence:
                return await this.attestationClient.verifyReferencedPaymentNonexistence(sourceId, normalizedProofData as any);
            default:
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
                throw new StateConnectorError(`Invalid attestation type ${matchedResponse.request.attestationType}`);
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
            receivingAddressHash: matchedResponse.receivingAddressHash,
            spentAmount: toBN(matchedResponse.spentAmount),
            receivedAmount: toBN(matchedResponse.receivedAmount),
            paymentReference: matchedResponse.paymentReference,
            oneToOne: matchedResponse.oneToOne,
            status: toBN(matchedResponse.status)
        };
    }

    private decodeBalanceDecreasingTransaction(matchedResponse: any, proof: string[]): DHBalanceDecreasingTransaction {
        return {
            stateConnectorRound: matchedResponse.stateConnectorRound,
            merkleProof: proof,
            blockNumber: toBN(matchedResponse.blockNumber),
            blockTimestamp: toBN(matchedResponse.blockTimestamp),
            transactionHash: matchedResponse.transactionHash,
            inUtxo: toBN(matchedResponse.inUtxo),
            sourceAddressHash: matchedResponse.sourceAddressHash,
            spentAmount: toBN(matchedResponse.spentAmount),
            paymentReference: matchedResponse.paymentReference
        };
    }

    private decodeConfirmedBlockHeightExists(matchedResponse: any, proof: string[]): DHConfirmedBlockHeightExists {
        return {
            stateConnectorRound: matchedResponse.stateConnectorRound,
            merkleProof: proof,
            blockNumber: toBN(matchedResponse.blockNumber),
            blockTimestamp: toBN(matchedResponse.blockTimestamp),
            numberOfConfirmations: toBN(matchedResponse.numberOfConfirmations),
            averageBlockProductionTimeMs: toBN(matchedResponse.averageBlockProductionTimeMs),
            lowestQueryWindowBlockNumber: toBN(matchedResponse.lowestQueryWindowBlockNumber),
            lowestQueryWindowBlockTimestamp: toBN(matchedResponse.lowestQueryWindowBlockTimestamp)
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
            firstOverflowBlockTimestamp: toBN(matchedResponse.firstOverflowBlockTimestamp)
        };
    }

    private lastClient(i: number): boolean {
        return i === this.clients.length - 1;
    }
}
