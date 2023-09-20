import {
    DHBalanceDecreasingTransaction,
    DHConfirmedBlockHeightExists,
    DHPayment,
    DHReferencedPaymentNonexistence,
    DHType,
} from "../verification/generated/attestation-hash-types";
import {
    ARBalanceDecreasingTransaction,
    ARConfirmedBlockHeightExists,
    ARPayment,
    ARReferencedPaymentNonexistence,
} from "../verification/generated/attestation-request-types";
import { AttestationType } from "../verification/generated/attestation-types-enum";
import { SourceId } from "../verification/sources/sources";
import { IBlockChain, TxInputOutput } from "./interfaces/IBlockChain";
import { AttestationRequestId, AttestationResponse, IStateConnectorClient } from "./interfaces/IStateConnectorClient";
import { web3 } from "../utils/web3";
import { ZERO_BYTES32 } from "../utils/helpers";
import { prefix0x, toHex } from "../verification/attestation-types/attestation-types-utils";
import { logger } from "../utils/logger";

// Attestation provider data that is always proved (i.e. contains Merkle proof).
export type ProvedDH<T extends DHType> = T & { merkleProof: string };

export class AttestationHelperError extends Error {
    constructor(message: string) {
        super(message);
    }
}

function findAddressIndex(ios: TxInputOutput[], address: string | null, defaultValue: number) {
    if (address == null) return defaultValue;
    for (let i = 0; i < ios.length; i++) {
        if (ios[i][0] === address) return i;
    }
    logger.error(`Attestation helper error: address ${address} not used in transaction`);
    throw new AttestationHelperError(`address ${address} not used in transaction`);
}

export class AttestationHelper {
    static deepCopyWithObjectCreate = true;

    constructor(
        public stateConnector: IStateConnectorClient,
        public chain: IBlockChain,
        public chainId: SourceId
    ) {}

    roundFinalized(round: number): Promise<boolean> {
        return this.stateConnector.roundFinalized(round);
    }

    waitForRoundFinalization(round: number): Promise<void> {
        return this.stateConnector.waitForRoundFinalization(round);
    }

    async requestPaymentProof(transactionHash: string, sourceAddress: string | null, receivingAddress: string | null): Promise<AttestationRequestId | null> {
        logger.info(
            `Attestation helper: requesting payment proof with transactionHash ${transactionHash}, sourceAddress ${sourceAddress} and receivingAddress ${receivingAddress}`
        );
        const transaction = await this.chain.getTransaction(transactionHash);
        const block = await this.chain.getTransactionBlock(transactionHash);
        if (transaction == null || block == null) {
            logger.error(`Attestation helper error: transaction not found ${transactionHash}`);
            throw new AttestationHelperError(`transaction not found ${transactionHash}`);
        }
        const request: ARPayment = {
            attestationType: AttestationType.Payment,
            sourceId: this.chainId,
            inUtxo: findAddressIndex(transaction.inputs, sourceAddress, 0),
            utxo: findAddressIndex(transaction.outputs, receivingAddress, 0),
            id: prefix0x(transactionHash),
            blockNumber: block.number,
            messageIntegrityCode: ZERO_BYTES32,
        };
        return await this.stateConnector.submitRequest(request);
    }

    async requestBalanceDecreasingTransactionProof(transactionHash: string, sourceAddress: string): Promise<AttestationRequestId | null> {
        logger.info(
            `Attestation helper: requesting balance decreasing transaction proof with transactionHash ${transactionHash} and sourceAddress ${sourceAddress}`
        );
        const transaction = await this.chain.getTransaction(transactionHash);
        const block = await this.chain.getTransactionBlock(transactionHash);
        if (transaction == null || block == null) {
            logger.error(`Attestation helper error: transaction not found ${transactionHash}`);
            throw new AttestationHelperError(`transaction not found ${transactionHash}`);
        }
        const request: ARBalanceDecreasingTransaction = {
            attestationType: AttestationType.BalanceDecreasingTransaction,
            sourceId: this.chainId,
            sourceAddressIndicator: web3.utils.keccak256(sourceAddress),
            id: prefix0x(transactionHash),
            blockNumber: block.number,
            messageIntegrityCode: ZERO_BYTES32,
        };
        return await this.stateConnector.submitRequest(request);
    }

    async requestReferencedPaymentNonexistenceProof(
        destinationAddress: string,
        paymentReference: string,
        amount: BN,
        startBlock: number,
        endBlock: number,
        endTimestamp: number
    ): Promise<AttestationRequestId | null> {
        logger.info(
            `Attestation helper: requesting referenced payment nonexistence proof with destinationAddress ${destinationAddress}, paymentReference ${paymentReference}, amount ${amount.toString()}, startBlock ${startBlock}, endBlock ${endBlock} and endTimestamp ${endTimestamp}`
        );
        let overflowBlock = await this.chain.getBlockAt(endBlock + 1);
        while (overflowBlock != null && overflowBlock.timestamp <= endTimestamp) {
            overflowBlock = await this.chain.getBlockAt(overflowBlock.number + 1);
        }
        if (overflowBlock == null) {
            logger.error(
                `Attestation helper error: overflow block not found (overflowBlock ${
                    endBlock + 1
                }, endTimestamp ${endTimestamp}, height ${await this.chain.getBlockHeight()})`
            );
            throw new AttestationHelperError(
                `overflow block not found (overflowBlock ${endBlock + 1}, endTimestamp ${endTimestamp}, height ${await this.chain.getBlockHeight()})`
            );
        }
        const request: ARReferencedPaymentNonexistence = {
            attestationType: AttestationType.ReferencedPaymentNonexistence,
            sourceId: this.chainId,
            minimalBlockNumber: startBlock,
            deadlineBlockNumber: endBlock,
            deadlineTimestamp: endTimestamp,
            destinationAddressHash: web3.utils.keccak256(destinationAddress),
            amount: toHex(amount),
            paymentReference: paymentReference,
            messageIntegrityCode: ZERO_BYTES32,
        };
        return await this.stateConnector.submitRequest(request);
    }

    async requestConfirmedBlockHeightExistsProof(queryWindow: number): Promise<AttestationRequestId | null> {
        logger.info(`Attestation helper: requesting confirmed block height exists proof with queryWindow ${queryWindow}`);
        const blockHeight = await this.chain.getBlockHeight();
        const finalizationBlock = await this.chain.getBlockAt(blockHeight);
        /* istanbul ignore if */
        if (finalizationBlock == null) {
            logger.error(`Attestation helper error: finalization block not found (block ${blockHeight}, height ${await this.chain.getBlockHeight()})`);
            throw new AttestationHelperError(`finalization block not found (block ${blockHeight}, height ${await this.chain.getBlockHeight()})`);
        }
        const request: ARConfirmedBlockHeightExists = {
            attestationType: AttestationType.ConfirmedBlockHeightExists,
            sourceId: this.chainId,
            blockNumber: blockHeight - this.chain.finalizationBlocks,
            queryWindow: queryWindow,
            messageIntegrityCode: ZERO_BYTES32,
        };
        return await this.stateConnector.submitRequest(request);
    }

    async obtainPaymentProof(round: number, requestData: string): Promise<AttestationResponse<DHPayment>> {
        logger.info(`Attestation helper: obtaining payment proof with round ${round} and requestData ${requestData}`);
        return (await this.stateConnector.obtainProof(round, requestData)) as AttestationResponse<DHPayment>;
    }

    async obtainBalanceDecreasingTransactionProof(round: number, requestData: string): Promise<AttestationResponse<DHBalanceDecreasingTransaction>> {
        logger.info(`Attestation helper: obtaining balance decreasing transaction proof with round ${round} and requestData ${requestData}`);
        return (await this.stateConnector.obtainProof(round, requestData)) as AttestationResponse<DHBalanceDecreasingTransaction>;
    }

    async obtainReferencedPaymentNonexistenceProof(round: number, requestData: string): Promise<AttestationResponse<DHReferencedPaymentNonexistence>> {
        logger.info(`Attestation helper: obtaining referenced payment nonexistence proof with round ${round} and requestData ${requestData}`);
        return (await this.stateConnector.obtainProof(round, requestData)) as AttestationResponse<DHReferencedPaymentNonexistence>;
    }

    async obtainConfirmedBlockHeightExistsProof(round: number, requestData: string): Promise<AttestationResponse<DHConfirmedBlockHeightExists>> {
        logger.info(`Attestation helper: obtaining confirmed block height exists proof with round ${round} and requestData ${requestData}`);
        return (await this.stateConnector.obtainProof(round, requestData)) as AttestationResponse<DHConfirmedBlockHeightExists>;
    }

    async provePayment(transactionHash: string, sourceAddress: string | null, receivingAddress: string | null): Promise<ProvedDH<DHPayment>> {
        logger.info(
            `Attestation helper: proving payment proof with transactionHash ${transactionHash}, sourceAddress ${sourceAddress} and receivingAddress ${receivingAddress}`
        );
        const request = await this.requestPaymentProof(transactionHash, sourceAddress, receivingAddress);
        if (request == null) {
            logger.error(`Attestation helper error: payment not proved`);
            throw new AttestationHelperError("payment: not proved");
        }
        await this.stateConnector.waitForRoundFinalization(request.round);
        const { result } = await this.obtainPaymentProof(request.round, request.data);
        /* istanbul ignore if */
        if (result == null || result.merkleProof == null) {
            logger.error(`Attestation helper error: payment not proved`);
            throw new AttestationHelperError("payment: not proved");
        }
        return result as ProvedDH<DHPayment>;
    }

    async proveBalanceDecreasingTransaction(transactionHash: string, sourceAddress: string): Promise<ProvedDH<DHBalanceDecreasingTransaction>> {
        logger.info(
            `Attestation helper: proving balance decreasing transaction proof with transactionHash ${transactionHash} and sourceAddress ${sourceAddress}`
        );
        const request = await this.requestBalanceDecreasingTransactionProof(transactionHash, sourceAddress);
        if (request == null) {
            logger.error(`Attestation helper error: balanceDecreasingTransaction not proved`);
            throw new AttestationHelperError("balanceDecreasingTransaction: not proved");
        }
        await this.stateConnector.waitForRoundFinalization(request.round);
        const { result } = await this.obtainBalanceDecreasingTransactionProof(request.round, request.data);
        /* istanbul ignore if */
        if (result == null || result.merkleProof == null) {
            logger.error(`Attestation helper error: balanceDecreasingTransaction not proved`);
            throw new AttestationHelperError("balanceDecreasingTransaction: not proved");
        }
        return result as ProvedDH<DHBalanceDecreasingTransaction>;
    }

    async proveReferencedPaymentNonexistence(
        destinationAddress: string,
        paymentReference: string,
        amount: BN,
        startBlock: number,
        endBlock: number,
        endTimestamp: number
    ): Promise<ProvedDH<DHReferencedPaymentNonexistence>> {
        logger.info(
            `Attestation helper: proving referenced payment nonexistence proof with destinationAddress ${destinationAddress}, paymentReference ${paymentReference}, amount ${amount.toString()}, startBlock ${startBlock}, endBlock ${endBlock} and endTimestamp ${endTimestamp}`
        );
        const request = await this.requestReferencedPaymentNonexistenceProof(destinationAddress, paymentReference, amount, startBlock, endBlock, endTimestamp);
        if (request == null) {
            logger.error(`Attestation helper error: referencedPaymentNonexistence not proved`);
            throw new AttestationHelperError("referencedPaymentNonexistence: not proved");
        }
        await this.stateConnector.waitForRoundFinalization(request.round);
        const { result } = await this.obtainReferencedPaymentNonexistenceProof(request.round, request.data);
        /* istanbul ignore if */
        if (result == null || result.merkleProof == null) {
            logger.error(`Attestation helper error: referencedPaymentNonexistence not proved`);
            throw new AttestationHelperError("referencedPaymentNonexistence: not proved");
        }
        return result as ProvedDH<DHReferencedPaymentNonexistence>;
    }

    async proveConfirmedBlockHeightExists(queryWindow: number): Promise<ProvedDH<DHConfirmedBlockHeightExists>> {
        logger.info(`Attestation helper: proving confirmed block height exists proof with queryWindow ${queryWindow}`);
        const request = await this.requestConfirmedBlockHeightExistsProof(queryWindow);
        if (request == null) {
            logger.error(`Attestation helper error: confirmedBlockHeightExists not proved`);
            throw new AttestationHelperError("confirmedBlockHeightExists: not proved");
        }
        await this.stateConnector.waitForRoundFinalization(request.round);
        const { result } = await this.obtainConfirmedBlockHeightExistsProof(request.round, request.data);
        /* istanbul ignore if */
        if (result == null || result.merkleProof == null) {
            logger.error(`Attestation helper error: confirmedBlockHeightExists not proved`);
            throw new AttestationHelperError("confirmedBlockHeightExists: not proved");
        }
        return result as ProvedDH<DHConfirmedBlockHeightExists>;
    }
}
