import { AddressValidity, BalanceDecreasingTransaction, ConfirmedBlockHeightExists, Payment, ReferencedPaymentNonexistence } from "@flarenetwork/state-connector-protocol";
import BN from "bn.js";
import Web3 from "web3";
import { squashSpace } from "../utils";
import { prefix0x, requireNotNull, toHex, ZERO_BYTES32 } from "../utils/helpers";
import { prefix0x, toHex, ZERO_BYTES32 } from "../utils/helpers";
import { logger } from "../utils/logger";
import { web3 } from "../utils/web3";
import { ChainId } from "./ChainId";
import { IBlockChain, TxInputOutput } from "./interfaces/IBlockChain";
import { AttestationNotProved, AttestationProof, AttestationRequestId, IFlareDataConnectorClient, OptionalAttestationProof } from "./interfaces/IFlareDataConnectorClient";

export class AttestationHelperError extends Error {
    constructor(message: string) {
        super(message);
    }
}

export function attestationProved<T extends ARESBase>(result: OptionalAttestationProof<T> | null | undefined): result is AttestationProof<T> {
    // OptionalAttestationProof is either AttestationProof (object) or unproved status (string)
    return typeof result === "object" && result != null;
}

function findAddressIndex(ios: TxInputOutput[], address: string | null, defaultValue: number) {
    if (address == null) return defaultValue;
    for (let i = 0; i < ios.length; i++) {
        if (ios[i][0] === address) return i;
    }
    if (ios.length === 0 || (ios.length === 1 && ios[0][0] === "")) {
        // special case needed e.g. for XRP failed transactions due to unactivated account
        logger.warn(`Attestation helper error: address ${address} not used in transaction`);
        return 0;
    } else {
        logger.error(`Attestation helper error: address ${address} not used in transaction`);
        throw new AttestationHelperError(`address ${address} not used in transaction`);
    }
}

export class AttestationHelper {
    static deepCopyWithObjectCreate = true;

    constructor(
        public flareDataConnector: IFlareDataConnectorClient,
        public chain: IBlockChain,
        public chainId: ChainId
    ) {}

    roundFinalized(round: number): Promise<boolean> {
        return this.flareDataConnector.roundFinalized(round);
    }

    waitForRoundFinalization(round: number): Promise<void> {
        return this.flareDataConnector.waitForRoundFinalization(round);
    }

    async requestPaymentProof(transactionHash: string, sourceAddress: string | null, receivingAddress: string | null): Promise<AttestationRequestId> {
        logger.info(`Attestation helper: requesting payment proof with transactionHash ${transactionHash}, sourceAddress ${sourceAddress} and receivingAddress ${receivingAddress}`);
        const transaction = await this.chain.getTransaction(transactionHash);
        const block = await this.chain.getTransactionBlock(transactionHash);
        if (transaction == null || block == null) {
            logger.error(`Attestation helper error: transaction not found ${transactionHash}`);
            throw new AttestationHelperError(`transaction not found ${transactionHash}`);
        }
        const request: Payment.Request = {
            attestationType: Payment.TYPE,
            sourceId: this.chainId.sourceId,
            messageIntegrityCode: ZERO_BYTES32,
            requestBody: {
                transactionId: prefix0x(transactionHash),
                inUtxo: String(findAddressIndex(transaction.inputs, sourceAddress, 0)),
                utxo: String(findAddressIndex(transaction.outputs, receivingAddress, 0)),
            },
        };
        return await this.flareDataConnector.submitRequest(request);
    }

    async requestBalanceDecreasingTransactionProof(transactionHash: string, sourceAddress: string): Promise<AttestationRequestId> {
        logger.info(`Attestation helper: requesting balance decreasing transaction proof with transactionHash ${transactionHash} and sourceAddress ${sourceAddress}`);
        const transaction = await this.chain.getTransaction(transactionHash);
        const block = await this.chain.getTransactionBlock(transactionHash);
        if (transaction == null || block == null) {
            logger.error(`Attestation helper error: transaction not found ${transactionHash}`);
            throw new AttestationHelperError(`transaction not found ${transactionHash}`);
        }
        const request: BalanceDecreasingTransaction.Request = {
            attestationType: BalanceDecreasingTransaction.TYPE,
            sourceId: this.chainId.sourceId,
            messageIntegrityCode: ZERO_BYTES32,
            requestBody: {
                transactionId: prefix0x(transactionHash),
                sourceAddressIndicator: web3.utils.keccak256(sourceAddress),
            },
        };
        return await this.flareDataConnector.submitRequest(request);
    }

    async requestReferencedPaymentNonexistenceProof(
        destinationAddress: string,
        paymentReference: string,
        amount: BN,
        startBlock: number,
        endBlock: number,
        endTimestamp: number,
        sourceAddresses?: string[],
    ): Promise<AttestationRequestId> {
        logger.info(squashSpace`Attestation helper: requesting referenced payment nonexistence proof with destinationAddress ${destinationAddress},
            paymentReference ${paymentReference}, amount ${amount.toString()}, startBlock ${startBlock}, endBlock ${endBlock}, endTimestamp ${endTimestamp}
            and sourceAddresses ${sourceAddresses}`);
        const overflowBlockNum = Math.max(endBlock + 1, await this.chain.getBlockHeight() - this.chain.finalizationBlocks);
        const overflowBlock = await this.chain.getBlockAt(overflowBlockNum);
        if (overflowBlock == null || overflowBlock.timestamp <= endTimestamp) {
            const info = `overflow block not found (overflowBlock ${endBlock + 1}, endTimestamp ${endTimestamp}, height ${await this.chain.getBlockHeight()})`;
            logger.error(`Attestation helper error: ${info}`);
            throw new AttestationHelperError(info);
        }
        const sourceAddressesRoot = sourceAddresses != null ? AttestationHelper.merkleRootOfAddresses(sourceAddresses) : ZERO_BYTES32;
        const request: ReferencedPaymentNonexistence.Request = {
            attestationType: ReferencedPaymentNonexistence.TYPE,
            sourceId: this.chainId.sourceId,
            messageIntegrityCode: ZERO_BYTES32,
            requestBody: {
                minimalBlockNumber: String(startBlock),
                deadlineBlockNumber: String(endBlock),
                deadlineTimestamp: String(endTimestamp),
                destinationAddressHash: web3.utils.keccak256(destinationAddress),
                amount: toHex(amount),
                standardPaymentReference: paymentReference,
                checkSourceAddresses: sourceAddresses != null,
                sourceAddressesRoot: sourceAddressesRoot,
            },
        };
        return await this.flareDataConnector.submitRequest(request);
    }

    static merkleRootOfAddresses(addresses: string[]) {
        const addressDoubleHashes = addresses.map(address => Web3.utils.soliditySha3Raw(Web3.utils.soliditySha3Raw(address)));
        addressDoubleHashes.sort();
        const tree = new MerkleTree(addressDoubleHashes);
        return requireNotNull(tree.root);
    }

    async requestConfirmedBlockHeightExistsProof(queryWindow: number): Promise<AttestationRequestId> {
        logger.info(`Attestation helper: requesting confirmed block height exists proof with queryWindow ${queryWindow}`);
        const blockHeight = await this.chain.getBlockHeight();
        const blockNumber = Math.max(blockHeight - this.chain.finalizationBlocks, 0);
        const finalizationBlockNumber = blockNumber + this.chain.finalizationBlocks;
        const finalizationBlock = await this.chain.getBlockAt(finalizationBlockNumber);
        /* istanbul ignore if */
        if (finalizationBlock == null) {
            logger.error(`Attestation helper error: finalization block not found (finalization block ${finalizationBlockNumber}, height ${blockHeight})`);
            throw new AttestationHelperError(`finalization block not found (finalization block ${finalizationBlockNumber}, height ${blockHeight})`);
        }
        const request: ConfirmedBlockHeightExists.Request = {
            attestationType: ConfirmedBlockHeightExists.TYPE,
            sourceId: this.chainId.sourceId,
            messageIntegrityCode: ZERO_BYTES32,
            requestBody: {
                blockNumber: String(blockNumber),
                queryWindow: String(queryWindow),
            },
        };
        return await this.flareDataConnector.submitRequest(request);
    }

    async requestAddressValidityProof(underlyingAddress: string): Promise<AttestationRequestId> {
        const request: AddressValidity.Request = {
            attestationType: AddressValidity.TYPE,
            sourceId: this.chainId.sourceId,
            messageIntegrityCode: ZERO_BYTES32,
            requestBody: {
                addressStr: underlyingAddress,
            },
        };
        return await this.flareDataConnector.submitRequest(request);
    }

    async obtainPaymentProof(round: number, requestData: string): Promise<Payment.Proof | AttestationNotProved> {
        logger.info(`Attestation helper: obtaining payment proof with round ${round} and requestData ${requestData}`);
        return await this.flareDataConnector.obtainProof(round, requestData);
    }

    async obtainBalanceDecreasingTransactionProof(round: number, requestData: string): Promise<BalanceDecreasingTransaction.Proof | AttestationNotProved> {
        logger.info(`Attestation helper: obtaining balance decreasing transaction proof with round ${round} and requestData ${requestData}`);
        return await this.flareDataConnector.obtainProof(round, requestData);
    }

    async obtainReferencedPaymentNonexistenceProof(round: number, requestData: string): Promise<ReferencedPaymentNonexistence.Proof | AttestationNotProved> {
        logger.info(`Attestation helper: obtaining referenced payment nonexistence proof with round ${round} and requestData ${requestData}`);
        return await this.flareDataConnector.obtainProof(round, requestData);
    }

    async obtainConfirmedBlockHeightExistsProof(round: number, requestData: string): Promise<ConfirmedBlockHeightExists.Proof | AttestationNotProved> {
        logger.info(`Attestation helper: obtaining confirmed block height exists proof with round ${round} and requestData ${requestData}`);
        return await this.flareDataConnector.obtainProof(round, requestData);
    }

    async obtainAddressValidityProof(round: number, requestData: string): Promise<AddressValidity.Proof | AttestationNotProved> {
        logger.info(`Attestation helper: obtaining address validity proof with round ${round} and requestData ${requestData}`);
        return await this.flareDataConnector.obtainProof(round, requestData);
    }

    async provePayment(transactionHash: string, sourceAddress: string | null, receivingAddress: string | null): Promise<Payment.Proof> {
        logger.info(`Attestation helper: proving payment proof with transactionHash ${transactionHash}, sourceAddress ${sourceAddress} and receivingAddress ${receivingAddress}`);
        const request = await this.requestPaymentProof(transactionHash, sourceAddress, receivingAddress);
        await this.flareDataConnector.waitForRoundFinalization(request.round);
        const result = await this.obtainPaymentProof(request.round, request.data);
        /* istanbul ignore if */
        if (!attestationProved(result)) {
            logger.error(`Attestation helper error: payment not proved`);
            throw new AttestationHelperError("payment: not proved");
        }
        return result;
    }

    async proveBalanceDecreasingTransaction(transactionHash: string, sourceAddress: string): Promise<BalanceDecreasingTransaction.Proof> {
        logger.info(`Attestation helper: proving balance decreasing transaction proof with transactionHash ${transactionHash} and sourceAddress ${sourceAddress}`);
        const request = await this.requestBalanceDecreasingTransactionProof(transactionHash, sourceAddress);
        await this.flareDataConnector.waitForRoundFinalization(request.round);
        const result = await this.obtainBalanceDecreasingTransactionProof(request.round, request.data);
        /* istanbul ignore if */
        if (!attestationProved(result)) {
            logger.error(`Attestation helper error: balanceDecreasingTransaction not proved`);
            throw new AttestationHelperError("balanceDecreasingTransaction: not proved");
        }
        return result;
    }

    async proveReferencedPaymentNonexistence(
        destinationAddress: string,
        paymentReference: string,
        amount: BN,
        startBlock: number,
        endBlock: number,
        endTimestamp: number,
        sourceAddresses?: string[],
    ): Promise<ReferencedPaymentNonexistence.Proof> {
        logger.info(`Attestation helper: proving referenced payment nonexistence proof with destinationAddress ${destinationAddress}, paymentReference ${paymentReference}, amount ${amount.toString()}, startBlock ${startBlock}, endBlock ${endBlock} and endTimestamp ${endTimestamp}`);
        const request = await this.requestReferencedPaymentNonexistenceProof(destinationAddress, paymentReference, amount, startBlock, endBlock, endTimestamp, sourceAddresses);
        await this.flareDataConnector.waitForRoundFinalization(request.round);
        const result = await this.obtainReferencedPaymentNonexistenceProof(request.round, request.data);
        /* istanbul ignore if */
        if (!attestationProved(result)) {
            logger.error(`Attestation helper error: referencedPaymentNonexistence not proved`);
            throw new AttestationHelperError("referencedPaymentNonexistence: not proved");
        }
        return result;
    }

    async proveConfirmedBlockHeightExists(queryWindow: number): Promise<ConfirmedBlockHeightExists.Proof> {
        logger.info(`Attestation helper: proving confirmed block height exists proof with queryWindow ${queryWindow}`);
        const request = await this.requestConfirmedBlockHeightExistsProof(queryWindow);
        await this.flareDataConnector.waitForRoundFinalization(request.round);
        const result = await this.obtainConfirmedBlockHeightExistsProof(request.round, request.data);
        /* istanbul ignore if */
        if (!attestationProved(result)) {
            logger.error(`Attestation helper error: confirmedBlockHeightExists not proved`);
            throw new AttestationHelperError("confirmedBlockHeightExists: not proved");
        }
        return result;
    }

    async proveAddressValidity(underlyingAddress: string): Promise<AddressValidity.Proof> {
        const request = await this.requestAddressValidityProof(underlyingAddress);
        await this.flareDataConnector.waitForRoundFinalization(request.round);
        const result = await this.obtainAddressValidityProof(request.round, request.data);
        if (!attestationProved(result)) {
            throw new AttestationHelperError("addressValidity: not proved");
        }
        return result;
    }
}
