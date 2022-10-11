import axios, { AxiosInstance, AxiosRequestConfig } from "axios";
import { AttestationClientSCInstance, IStateConnectorInstance } from "../../typechain-truffle";
import { MerkleTree } from "../mock/MerkleTree";
import { artifacts } from "../utils/artifacts";
import { requiredEventArgs } from "../utils/events/truffle";
import { sleep, toBN, toNumber } from "../utils/helpers";
import { hexlifyBN } from "../verification/attestation-types/attestation-types-helpers";
import { DHType } from "../verification/generated/attestation-hash-types";
import { encodeRequest } from "../verification/generated/attestation-request-encode";
import { AttestationType } from "../verification/generated/attestation-types-enum";
import { AttestationRequest, AttestationResponse, IStateConnectorClient } from "./interfaces/IStateConnectorClient";

const DEFAULT_TIMEOUT = 15000;

export class StateConnectorClientHelper implements IStateConnectorClient {

    client: AxiosInstance;
    attestationClientAddress: string;
    stateConnectorAddress: string;
    account: string;

    // all initialized at initStateConnector()
    stateConnector!: IStateConnectorInstance;
    firstEpochStartTime!: number;
    roundDurationSec!: number;

    constructor(
        url: string,
        attestationClientAddress: string,
        stateConnectorAddress: string,
        account: string
    ) {
        const createAxiosConfig: AxiosRequestConfig = {
            baseURL: url,
            timeout: DEFAULT_TIMEOUT,
            headers: { "Content-Type": "application/json" },
            validateStatus: function (status: number) {
                return (status >= 200 && status < 300) || status == 500;
            },
        };
        //set client
        this.client = axios.create(createAxiosConfig);
        //set addresses
        this.attestationClientAddress = attestationClientAddress;
        this.stateConnectorAddress = stateConnectorAddress;
        this.account = account;
    }

    async initStateConnector() {
        const IStateConnector = artifacts.require("IStateConnector");
        this.stateConnector = await IStateConnector.at(this.stateConnectorAddress);
        this.firstEpochStartTime = toNumber(await this.stateConnector.BUFFER_TIMESTAMP_OFFSET());
        this.roundDurationSec = toNumber(await this.stateConnector.BUFFER_WINDOW());
    }
    
    static async create(url: string, attestationClientAddress: string, stateConnectorAddress: string, account: string) {
        const helper = new StateConnectorClientHelper(url, attestationClientAddress, stateConnectorAddress, account);
        await helper.initStateConnector();
        return helper;
    }

    async roundFinalized(round: number): Promise<boolean> {
        const res = await this.client.get(`/api/proof/status`);
        const status = res.data.status;
        const data = res.data.data;
        if (status === "OK") {
            if (round <= data.latestAvailableRoundId) {
                return true;
            }
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
        const txres = await this.stateConnector.requestAttestations(data, { from: this.account });
        const attReq = requiredEventArgs(txres, 'AttestationRequest')
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
        const AttestationClientSC = artifacts.require("AttestationClientSC");
        const attestationClient: AttestationClientSCInstance = await AttestationClientSC.at(this.attestationClientAddress);

        const resp = await this.client.get(`/api/proof/votes-for-round/${round}`);
        const status = resp.data.status;
        const data = resp.data.data;

        if (status === "OK" && data.length > 0) {
            let matchedResponse: any = null;
            for (let item of data) {
                let encoded = encodeRequest(item.request);
                if (encoded === requestData) {
                    matchedResponse = item;
                }
            }
            if (matchedResponse) {
                let hashes: string[] = data.map((item: any) => item.hash) as string[];
                const tree = new MerkleTree(hashes);
                const index = tree.sortedHashes.findIndex((hash) => hash === matchedResponse.hash);
                const proof = tree.getProof(index);

                let blockchainVerification = false;
                try {
                    let responseHex = hexlifyBN(matchedResponse.response);
                    responseHex.merkleProof = proof;
                    responseHex.stateConnectorRound = round + 2;
                    const sourceId = matchedResponse.request.sourceId;

                    switch (matchedResponse.request.attestationType) {
                        case AttestationType.Payment:
                            console.log('Payment');
                            blockchainVerification = await attestationClient.verifyPayment(sourceId, responseHex);
                            if (blockchainVerification) {
                                return {
                                    finalized: blockchainVerification,
                                    result: {
                                        stateConnectorRound: matchedResponse.stateConnectorRound,
                                        merkleProof: proof ? proof : undefined,
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
                                        status: toBN(status)
                                    }
                                }
                            }
                            break;
                        case AttestationType.BalanceDecreasingTransaction:
                            console.log('verifyBalanceDecreasingTransaction');
                            blockchainVerification = await attestationClient.verifyBalanceDecreasingTransaction(sourceId, responseHex);
                            if (blockchainVerification) {
                                return {
                                    finalized: blockchainVerification,
                                    result: {
                                        stateConnectorRound: matchedResponse.stateConnectorRound,
                                        merkleProof: proof ? proof : undefined,
                                        blockNumber: toBN(matchedResponse.blockNumber),
                                        blockTimestamp: toBN(matchedResponse.blockTimestamp),
                                        transactionHash: matchedResponse.transactionHash,
                                        inUtxo: toBN(matchedResponse.inUtxo),
                                        sourceAddressHash: matchedResponse.sourceAddressHash,
                                        spentAmount: toBN(matchedResponse.spentAmount),
                                        paymentReference: matchedResponse.paymentReference
                                    }
                                }
                            }
                            break;
                        case AttestationType.ConfirmedBlockHeightExists:
                            console.log('verifyConfirmedBlockHeightExists');
                            blockchainVerification = await attestationClient.verifyConfirmedBlockHeightExists(sourceId, responseHex);
                            if (blockchainVerification) {
                                return {
                                    finalized: blockchainVerification,
                                    result: {
                                        stateConnectorRound: matchedResponse.stateConnectorRound,
                                        merkleProof: proof ? proof : undefined,
                                        blockNumber: toBN(matchedResponse.blockNumber),
                                        blockTimestamp: toBN(matchedResponse.blockTimestamp),
                                        numberOfConfirmations: toBN(matchedResponse.numberOfConfirmations),
                                        averageBlockProductionTimeMs: toBN(matchedResponse.averageBlockProductionTimeMs),
                                        lowestQueryWindowBlockNumber: toBN(matchedResponse.lowestQueryWindowBlockNumber),
                                        lowestQueryWindowBlockTimestamp: toBN(matchedResponse.lowestQueryWindowBlockTimestamp),
                                    }
                                }
                            }
                            break;
                        case AttestationType.ReferencedPaymentNonexistence:
                            console.log('verifyReferencedPaymentNonexistence');
                            blockchainVerification = await attestationClient.verifyReferencedPaymentNonexistence(sourceId, responseHex);
                            if (blockchainVerification) {
                                return {
                                    finalized: blockchainVerification,
                                    result: {
                                        stateConnectorRound: matchedResponse.stateConnectorRound,
                                        merkleProof: proof ? proof : undefined,
                                        deadlineBlockNumber: toBN(matchedResponse.deadlineBlockNumber),
                                        deadlineTimestamp: toBN(matchedResponse.deadlineTimestamp),
                                        destinationAddressHash: matchedResponse.destinationAddressHash,
                                        paymentReference: matchedResponse.paymentReference,
                                        amount: toBN(matchedResponse.amount),
                                        lowerBoundaryBlockNumber: toBN(matchedResponse.lowerBoundaryBlockNumber),
                                        lowerBoundaryBlockTimestamp: toBN(matchedResponse.lowerBoundaryBlockTimestamp),
                                        firstOverflowBlockNumber: toBN(matchedResponse.firstOverflowBlockNumber),
                                        firstOverflowBlockTimestamp: toBN(matchedResponse.firstOverflowBlockTimestamp),
                                    }
                                }
                            }
                            break;
                        default:
                            break;
                    }
                } catch (e) {
                    console.log(e);
                }
            }
        }
        return {
            finalized: false,
            result: null
        }
    }

}
