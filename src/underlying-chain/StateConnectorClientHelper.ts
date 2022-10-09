import { DHType } from "../verification/generated/attestation-hash-types";
import { AttestationRequest, AttestationResponse, IStateConnectorClient } from "./interfaces/IStateConnectorClient";
import axios, { AxiosRequestConfig } from "axios";
import { MerkleTree } from "../mock/MerkleTree";
import { encodeRequest } from "../verification/generated/attestation-request-encode";
import { hexlifyBN } from "../verification/attestation-types/attestation-types-helpers";
import { AttestationType } from "../verification/generated/attestation-types-enum";
import { timestampToRoundId, toBN } from "../utils/helpers";
import { artifacts } from "../utils/artifacts";
import { AttestationClientSCInstance, IStateConnectorInstance } from "../../typechain-truffle";
import { web3 } from "../utils/web3";
import Web3 from "web3";

const DEFAULT_TIMEOUT = 15000;

export class StateConnectorClientHelper implements IStateConnectorClient {

    client: any;
    attestationClientAddress: string = "";
    stateConnectorAddress: string = "";
    account: string = "";

    constructor(
        url: string,
        rpcUrl: string, 
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
        //set provider
        web3.setProvider(new Web3.providers.HttpProvider(rpcUrl));
        artifacts.updateWeb3(web3);
        //set addresses
        this.attestationClientAddress = attestationClientAddress;
        this.stateConnectorAddress = stateConnectorAddress;
        this.account = account;
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
        let roundFinalized = await this.roundFinalized(round)
        while (!roundFinalized) { }
    }

    async submitRequest(data: string): Promise<AttestationRequest> {
        const StateConnector = artifacts.require("IStateConnector");
        const stateConnector: IStateConnectorInstance = await StateConnector.at(this.stateConnectorAddress || "");

        let txres: any;
        let confirmed_timestamp = 0;
        let calculated_round_id = 0;
        try {
               txres = await stateConnector.requestAttestations(data, { from: this.account });
               const block = await web3.eth.getBlock(txres?.blockNumber)
               confirmed_timestamp = typeof(block.timestamp) === "string" ? parseInt(block.timestamp) : block.timestamp;
               calculated_round_id = timestampToRoundId(confirmed_timestamp);
        } catch (e) {
            console.log(e);
        }
        return {
            round: calculated_round_id,
            data: data
        }
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