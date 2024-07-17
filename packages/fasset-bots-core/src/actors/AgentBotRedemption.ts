import { ConfirmedBlockHeightExists } from "@flarenetwork/state-connector-protocol";
import { RequiredEntityData } from "@mikro-orm/core";
import BN from "bn.js";
import { RedemptionDefault, RedemptionPaymentBlocked, RedemptionPaymentFailed, RedemptionPerformed, RedemptionRequested } from "../../typechain-truffle/IIAssetManager";
import { EM } from "../config/orm";
import { AgentRedemption } from "../entities/agent";
import { AgentRedemptionFinalState, AgentRedemptionState } from "../entities/common";
import { Agent } from "../fasset/Agent";
import { AttestationHelperError, attestationProved } from "../underlying-chain/AttestationHelper";
import { IBlock } from "../underlying-chain/interfaces/IBlockChain";
import { AttestationNotProved } from "../underlying-chain/interfaces/IStateConnectorClient";
import { EventArgs } from "../utils/events/common";
import { squashSpace } from "../utils/formatting";
import { assertNotNull, BNish, messageForExpectedError, requireNotNull, toBN } from "../utils/helpers";
import { logger } from "../utils/logger";
import { AgentNotifier } from "../utils/notifier/AgentNotifier";
import { web3DeepNormalize } from "../utils/web3normalize";
import { AgentBot } from "./AgentBot";

const REDEMPTION_BATCH = 1000;

type RedemptionId = { id: number } | { requestId: BN };

export class AgentBotRedemption {
    static deepCopyWithObjectCreate = true;

    constructor(
        public bot: AgentBot,
        public agent: Agent,
        public notifier: AgentNotifier,
    ) {}

    context = this.agent.context;

    handleMaxNonPriorityRedemptions = 50;

    /**
     * Stores received redemption request as redemption in persistent state.
     * @param em entity manager
     * @param request event's RedemptionRequested arguments
     */
    async redemptionStarted(rootEm: EM, request: EventArgs<RedemptionRequested>): Promise<void> {
        await this.bot.runInTransaction(rootEm, async (em) => {
            em.create(
                AgentRedemption,
                {
                    state: AgentRedemptionState.STARTED,
                    agentAddress: this.agent.vaultAddress,
                    requestId: toBN(request.requestId),
                    paymentAddress: request.paymentAddress,
                    valueUBA: toBN(request.valueUBA),
                    feeUBA: toBN(request.feeUBA),
                    paymentReference: request.paymentReference,
                    lastUnderlyingBlock: toBN(request.lastUnderlyingBlock),
                    lastUnderlyingTimestamp: toBN(request.lastUnderlyingTimestamp),
                } as RequiredEntityData<AgentRedemption>,
                { persist: true }
            );
        });
        await this.notifier.sendRedemptionStarted(request.requestId);
        logger.info(`Agent ${this.agent.vaultAddress} started redemption ${request.requestId}.`);
    }

    async redemptionPerformed(rootEm: EM, args: EventArgs<RedemptionPerformed>) {
        await this.finishRedemption(rootEm, args, AgentRedemptionFinalState.PERFORMED);
        await this.notifier.sendRedemptionWasPerformed(args.requestId, args.redeemer);
    }

    async redemptionPaymentFailed(rootEm: EM, args: EventArgs<RedemptionPaymentFailed>) {
        await this.finishRedemption(rootEm, args, AgentRedemptionFinalState.FAILED);
        await this.notifier.sendRedemptionFailed(args.requestId.toString(), args.transactionHash, args.redeemer, args.failureReason);
    }

    async redemptionPaymentBlocked(rootEm: EM, args: EventArgs<RedemptionPaymentBlocked>) {
        await this.finishRedemption(rootEm, args, AgentRedemptionFinalState.BLOCKED);
        await this.notifier.sendRedemptionBlocked(args.requestId.toString(), args.transactionHash, args.redeemer);
    }

    async redemptionDefault(rootEm: EM, args: EventArgs<RedemptionDefault>) {
        await this.updateRedemption(rootEm, { requestId: toBN(args.requestId) }, {
            defaulted: true,
        });
        await this.notifier.sendRedemptionDefaulted(args.requestId.toString(), args.redeemer);
    }

    /**
     * Marks stored redemption in persistent state as DONE, then it checks AgentBot's and owner's underlying balance.
     * @param em entity manager
     * @param requestId redemption request id
     * @param agentVault agent's vault address
     */
    private async finishRedemption(rootEm: EM, rd: { requestId: BNish }, finalState: AgentRedemptionFinalState) {
        await this.updateRedemption(rootEm, { requestId: toBN(rd.requestId) }, {
            state: AgentRedemptionState.DONE,
            finalState: finalState,
        });
        logger.info(`Agent ${this.agent.vaultAddress} closed redemption ${rd.requestId} in state ${finalState}.`);
        await this.bot.underlyingManagement.checkUnderlyingBalanceAndTopup(rootEm);
    }

    // handle redemptions serially - used for tests
    async handleOpenRedemptions(rootEm: EM) {
        for (const redemptionState of Object.values(AgentRedemptionState)) {
            if (redemptionState === AgentRedemptionState.DONE) continue;
            await this.handleRedemptionsInState(rootEm, redemptionState);
        }
        await this.handleExpiredRedemptions(rootEm);
    }

    async handleRedemptionsInState(rootEm: EM, state: AgentRedemptionState, batchSize: number = REDEMPTION_BATCH) {
        const redemptions = await this.redemptionsInState(rootEm, state, batchSize);
        logger.info(`Agent ${this.agent.vaultAddress} is handling ${redemptions.length} redemptions in state ${state}`);
        for (const redemption of redemptions) {
            if (this.bot.stopRequested()) return;
            try {
                await this.handleOpenRedemption(rootEm, state, redemption);
            } catch (error) {
                logger.error(`Error handling redemption ${redemption.requestId} in state ${state}`, error);
            }
        }
    }

    async handleExpiredRedemptions(rootEm: EM, batchSize: number = REDEMPTION_BATCH) {
        const expirationProof = await this.bot.getUnderlyingBlockHeightProof();
        if (!expirationProof) return;
        if (this.bot.stopRequested()) return;
        const redemptions = await this.expiredRedemptions(rootEm, expirationProof, batchSize);
        const proof = expirationProof.data.responseBody;
        logger.info(squashSpace`Agent ${this.agent.vaultAddress} is handling ${redemptions.length} expired redemptions
            (lqwBlock=${proof.lowestQueryWindowBlockNumber}, lqwTimestamp=${proof.lowestQueryWindowBlockTimestamp})`);
        for (const redemption of redemptions) {
            if (this.bot.stopRequested()) return;
            try {
                await this.handleExpiredRedemption(rootEm, redemption, expirationProof);
            } catch (error) {
                logger.error(`Error expiring redemption ${redemption.requestId}`, error);
            }
        }
    }

    /**
     * Returns minting in given state.
     * If there are too many redemptions, prioritize those in state STARTED.
     * @param rootEm entity manager
     * * @return list of AgentRedemption's instances
     */
    async redemptionsInState(rootEm: EM, state: AgentRedemptionState, limit: number): Promise<AgentRedemption[]> {
        return await rootEm.createQueryBuilder(AgentRedemption)
            .where({
                agentAddress: this.agent.vaultAddress,
                state: state
            })
            .limit(limit)
            .getResultList();
    }

    async expiredRedemptions(rootEm: EM, expirationProof: ConfirmedBlockHeightExists.Proof, limit: number): Promise<AgentRedemption[]> {
        return await rootEm.createQueryBuilder(AgentRedemption)
            .where({
                agentAddress: this.agent.vaultAddress,
                lastUnderlyingBlock: { $lt: toBN(expirationProof.data.responseBody.lowestQueryWindowBlockNumber) },
                lastUnderlyingTimestamp: { $lt: toBN(expirationProof.data.responseBody.lowestQueryWindowBlockTimestamp) },
                state: { $nin: [AgentRedemptionState.STARTED, AgentRedemptionState.DONE] }
            })
            .limit(limit)
            .getResultList();
    }

    async handleOpenRedemption(rootEm: EM, state: AgentRedemptionState, redemption: Readonly<AgentRedemption>) {
        switch (state) {
            case AgentRedemptionState.STARTED:
                await this.checkBeforeRedemptionPayment(rootEm, redemption);
                break;
            case AgentRedemptionState.PAYING:
                // TODO: once simple wallet starts handling retries in background, find payment in indekser by address and payment reference
                break;
            case AgentRedemptionState.UNPAID:
                // bot didn't manage to pay in time - do nothing and it will be expired after 24h
                break;
            case AgentRedemptionState.PAID:
                await this.checkPaymentProofAvailable(rootEm, redemption);
                break;
            case AgentRedemptionState.REQUESTED_PROOF:
                await this.checkConfirmPayment(rootEm, redemption);
                break;
            case AgentRedemptionState.REQUESTED_REJECTION_PROOF:
                await this.checkRejectRedemptionProof(rootEm, redemption);
                break;
            default:
                console.error(`Redemption state: ${redemption.state} not supported`);
                logger.error(`Agent ${this.agent.vaultAddress} run into redemption state ${redemption.state} not supported for redemption ${redemption.requestId}.`);
        }
    }

    async handleExpiredRedemption(rootEm: EM, redemption: Readonly<AgentRedemption>, proof: ConfirmedBlockHeightExists.Proof) {
        logger.info(`Agent ${this.agent.vaultAddress} found expired unpaid redemption ${redemption.requestId} and is calling 'finishRedemptionWithoutPayment'.`);
        await this.bot.locks.nativeChainLock(this.bot.owner.workAddress).lockAndRun(async () => {
            await this.context.assetManager.finishRedemptionWithoutPayment(web3DeepNormalize(proof), redemption.requestId, { from: this.agent.owner.workAddress });
        });
        redemption = await this.updateRedemption(rootEm, redemption, {
            state: AgentRedemptionState.DONE,
            finalState: this.getFinalState(redemption),
        });
        await this.notifier.sendRedemptionExpiredInIndexer(redemption.requestId);
        logger.info(`Agent ${this.agent.vaultAddress} closed redemption ${redemption.requestId}.`);
    }

    private getFinalState(redemption: Readonly<AgentRedemption>): AgentRedemptionFinalState | undefined {
        switch (redemption.state) {
            case AgentRedemptionState.PAYING:
                return AgentRedemptionFinalState.EXPIRED_PAYING;
            case AgentRedemptionState.PAID:
            case AgentRedemptionState.REQUESTED_PROOF:
                return AgentRedemptionFinalState.EXPIRED_PAID;
            case AgentRedemptionState.UNPAID:
            case AgentRedemptionState.STARTED:
            case AgentRedemptionState.REQUESTED_REJECTION_PROOF:
                return AgentRedemptionFinalState.EXPIRED_UNPAID;
            // no need to handle DONE
        }
    }

    /**
     * When redemption is in state STARTED, it checks if payment can be done in time.
     * Then it performs payment and sets the state of redemption in persistent state as PAID.
     * @param redemption AgentRedemption entity
     */
    async checkBeforeRedemptionPayment(rootEm: EM, redemption: Readonly<AgentRedemption>): Promise<void> {
        const blockHeight = await this.context.blockchainIndexer.getBlockHeight();
        const lastBlock = await this.context.blockchainIndexer.getBlockAt(blockHeight);
        /* istanbul ignore else */
        if (lastBlock && this.stillTimeToPayForRedemption(lastBlock, redemption)) {
            const validation = await this.context.verificationClient.checkAddressValidity(this.context.chainInfo.chainId.sourceId, redemption.paymentAddress);
            if (validation.isValid && validation.standardAddress === redemption.paymentAddress) {
                await this.payForRedemption(rootEm, redemption);
            } else {
                await this.startRejectRedemption(rootEm, redemption);
            }
        } else if (lastBlock) {
            logger.info(squashSpace`Agent ${this.agent.vaultAddress} DID NOT pay for redemption ${redemption.requestId}.
                Time expired on underlying chain. Last block for payment was ${redemption.lastUnderlyingBlock}
                with timestamp ${redemption.lastUnderlyingTimestamp}. Current block is ${lastBlock.number}
                with timestamp ${lastBlock.timestamp}.`);
            redemption = await this.updateRedemption(rootEm, redemption, {
                state: AgentRedemptionState.UNPAID,
            });
        } else {
            logger.info(`Agent ${this.agent.vaultAddress} could not retrieve last block in checkBeforeRedemptionPayment for ${redemption.requestId}.`);
        }
    }

    async payForRedemption(rootEm: EM, redemption: Readonly<AgentRedemption>) {
        logger.info(`Agent ${this.agent.vaultAddress} is trying to pay for redemption ${redemption.requestId}.`);
        const paymentAmount = toBN(redemption.valueUBA).sub(toBN(redemption.feeUBA));
        redemption = await this.updateRedemption(rootEm, redemption, {
            state: AgentRedemptionState.PAYING,
        });
        try {
            // TODO: what if there are too little funds on underlying address to pay for fee?
            const txHash = await this.bot.locks.underlyingLock(this.agent.underlyingAddress).lockAndRun(async () => {
                return await this.agent.performPayment(redemption.paymentAddress, paymentAmount, redemption.paymentReference);
            });
            redemption = await this.updateRedemption(rootEm, redemption, {
                txHash: txHash,
                state: AgentRedemptionState.PAID,
            });
            await this.notifier.sendRedemptionPaid(redemption.requestId);
            logger.info(squashSpace`Agent ${this.agent.vaultAddress} paid for redemption ${redemption.requestId}
                with txHash ${txHash}; target underlying address ${redemption.paymentAddress}, payment reference
                ${redemption.paymentReference}, amount ${paymentAmount}.`);
        } catch (error) {
            logger.error(`Error trying to pay for redemption ${redemption.requestId}:`, error);
            await this.notifier.sendRedemptionPaymentFailed(redemption.requestId);
        }
    }

    async redeemerAddressValid(underlyingAddress: string) {
        const validation = await this.context.verificationClient.checkAddressValidity(this.context.chainInfo.chainId.sourceId, underlyingAddress);
        return validation.isValid && validation.standardAddress === underlyingAddress;
    }

    async startRejectRedemption(rootEm: EM, redemption: Readonly<AgentRedemption>) {
        logger.info(squashSpace`Agent ${this.agent.vaultAddress} is sending request for payment address invalidity
            for redemption ${redemption.requestId} and address ${redemption.paymentAddress}.`);
        try {
            const request = await this.bot.locks.nativeChainLock(this.bot.requestSubmitterAddress()).lockAndRun(async () => {
                return await this.context.attestationProvider.requestAddressValidityProof(redemption.paymentAddress);
            });
            redemption = await this.updateRedemption(rootEm, redemption, {
                state: AgentRedemptionState.REQUESTED_REJECTION_PROOF,
                proofRequestRound: request.round,
                proofRequestData: request.data,
            });
            logger.info(squashSpace`Agent ${this.agent.vaultAddress} requested payment proof for payment address invalidity
                    for redemption ${redemption.requestId} and address ${redemption.paymentAddress},
                    proofRequestRound ${request.round}, proofRequestData ${request.data}`);
        } catch (error) {
            logger.info(squashSpace`Agent ${this.agent.vaultAddress} cannot request payment proof for payment address invalidity
                for redemption ${redemption.requestId} and address ${redemption.paymentAddress}.`,
                messageForExpectedError(error, [AttestationHelperError]));
        }
    }

    async checkRejectRedemptionProof(rootEm: EM, redemption: Readonly<AgentRedemption>): Promise<void> {
        logger.info(squashSpace`Agent ${this.agent.vaultAddress} is trying to obtain proof for payment address invalidity
            for redemption ${redemption.requestId} and address ${redemption.paymentAddress}
            in round ${redemption.proofRequestRound} and data ${redemption.proofRequestData}.`);
        assertNotNull(redemption.proofRequestRound);
        assertNotNull(redemption.proofRequestData);
        const proof = await this.context.attestationProvider.obtainAddressValidityProof(redemption.proofRequestRound, redemption.proofRequestData)
            .catch(e => {
                logger.error(`Error obtaining address validity proof for redemption ${redemption.requestId}:`, e);
                return null;
            });
        if (proof === AttestationNotProved.NOT_FINALIZED) {
            logger.info(squashSpace`Agent ${this.agent.vaultAddress}: proof not yet finalized for address validation for redemption
                ${redemption.requestId} in round ${redemption.proofRequestRound} and data ${redemption.proofRequestData}.`);
        } else if (attestationProved(proof)) {
            const response = proof.data.responseBody;
            if (!response.isValid || response.standardAddress !== redemption.paymentAddress) {
                logger.info(squashSpace`Agent ${this.agent.vaultAddress} obtained address validation proof for redemption
                    ${redemption.requestId} in round ${redemption.proofRequestRound} and data ${redemption.proofRequestData}.`);
                await this.bot.locks.nativeChainLock(this.bot.owner.workAddress).lockAndRun(async () => {
                    await this.context.assetManager.rejectInvalidRedemption(web3DeepNormalize(proof), redemption.requestId, { from: this.agent.owner.workAddress });
                });
                redemption = await this.updateRedemption(rootEm, redemption, {
                    state: AgentRedemptionState.DONE,
                    finalState: AgentRedemptionFinalState.REJECTED,
                });
                logger.info(squashSpace`Agent ${this.agent.vaultAddress} rejected redemption ${redemption.requestId}
                    with proof ${JSON.stringify(web3DeepNormalize(proof))}.`);
            } else {
                // this should never happen unless there is a problem with the verifier server
                logger.info(squashSpace`Agent ${this.agent.vaultAddress} obtained conflicting address validation proof
                    for redemption ${redemption.requestId} in round ${redemption.proofRequestRound} and data ${redemption.proofRequestData}.`);
                await this.notifier.sendRedemptionAddressValidationProofConflict(redemption.requestId,
                    redemption.proofRequestRound, redemption.proofRequestData, redemption.paymentAddress);
            }
        } else {
            logger.info(squashSpace`Agent ${this.agent.vaultAddress} cannot obtain address validation proof for redemption ${redemption.requestId}
                in round ${redemption.proofRequestRound} and data ${redemption.proofRequestData}.`);
            // wait for one more round and then reset to state STARTED, which will eventually resubmit request
            if (await this.bot.enoughTimePassedToObtainProof(redemption)) {
                await this.notifier.sendRedemptionAddressValidationNoProof(redemption.requestId,
                    redemption.proofRequestRound, redemption.proofRequestData, redemption.paymentAddress);
                logger.info(`Agent ${this.agent.vaultAddress} will retry obtaining address validation proof for redemption ${redemption.requestId}.`);
                redemption = await this.updateRedemption(rootEm, redemption, {
                    state: AgentRedemptionState.STARTED,
                    proofRequestRound: undefined,
                    proofRequestData: undefined,
                });
            }
        }
    }

    /**
     * Checks if redemption payment can be made in time (as specified in redemption event).
     * @param lastBlock
     * @param redemption
     * @returns
     */
    stillTimeToPayForRedemption(lastBlock: IBlock, redemption: Readonly<AgentRedemption>): boolean {
        const lastAcceptedBlockNumber = lastBlock.number + this.context.blockchainIndexer.finalizationBlocks + 1;
        const lastAcceptedTimestamp =
            lastBlock.timestamp +
            this.context.blockchainIndexer.finalizationBlocks * this.context.blockchainIndexer.secondsPerBlock +
            this.context.blockchainIndexer.secondsPerBlock;
        return toBN(lastAcceptedBlockNumber).lt(toBN(redemption.lastUnderlyingBlock)) ||
            toBN(lastAcceptedTimestamp).lt(toBN(redemption.lastUnderlyingTimestamp));
    }

    /**
     * When redemption is in state PAID it requests payment proof - see requestPaymentProof().
     * @param redemption AgentRedemption entity
     */
    async checkPaymentProofAvailable(rootEm: EM, redemption: Readonly<AgentRedemption>): Promise<void> {
        logger.info(`Agent ${this.agent.vaultAddress} is checking if payment proof for redemption ${redemption.requestId} is available.`);
        assertNotNull(redemption.txHash);
        const txBlock = await this.context.blockchainIndexer.getTransactionBlock(redemption.txHash);
        const blockHeight = await this.context.blockchainIndexer.getBlockHeight();
        if (txBlock != null && blockHeight - txBlock.number >= this.context.blockchainIndexer.finalizationBlocks) {
            await this.requestPaymentProof(rootEm, redemption);
            await this.notifier.sendRedemptionRequestPaymentProof(redemption.requestId.toString());
        }
    }

    /**
     * Sends request for redemption payment proof, sets state for redemption in persistent state to REQUESTED_PROOF.
     * @param redemption AgentRedemption entity
     */
    async requestPaymentProof(rootEm: EM, redemption: Readonly<AgentRedemption>): Promise<void> {
        logger.info(squashSpace`Agent ${this.agent.vaultAddress} is sending request for payment proof transaction ${redemption.txHash}
            and redemption ${redemption.requestId}.`);
        const txHash = requireNotNull(redemption.txHash);
        try {
            const request = await this.bot.locks.nativeChainLock(this.bot.requestSubmitterAddress()).lockAndRun(async () => {
                return await this.context.attestationProvider.requestPaymentProof(txHash, this.agent.underlyingAddress, redemption.paymentAddress);
            });
            redemption = await this.updateRedemption(rootEm, redemption, {
                state: AgentRedemptionState.REQUESTED_PROOF,
                proofRequestRound: request.round,
                proofRequestData: request.data,
            });
            logger.info(squashSpace`Agent ${this.agent.vaultAddress} requested payment proof for transaction ${txHash}
                and redemption ${redemption.requestId}; target underlying address ${redemption.paymentAddress},
                proofRequestRound ${request.round}, proofRequestData ${request.data}`);
        } catch (error) {
            logger.error(`Agent ${this.agent.vaultAddress} cannot yet request payment proof for transaction ${txHash} and redemption ${redemption.requestId}.`,
                messageForExpectedError(error, [AttestationHelperError]));
        }
    }

    /**
     * When redemption is in state REQUESTED_PROOF, it obtains payment proof, calls confirmRedemptionPayment and sets the state of redemption in persistent state as DONE.
     * If proof expired (corner case), it calls finishRedemptionWithoutPayment, sets the state of redemption in persistent state as DONE and send notification to owner.
     * If proof cannot be obtained, it sends notification to owner.
     * @param redemption AgentRedemption entity
     */
    async checkConfirmPayment(rootEm: EM, redemption: Readonly<AgentRedemption>): Promise<void> {
        logger.info(`Agent ${this.agent.vaultAddress} is trying to obtain payment proof for redemption ${redemption.requestId} in round ${redemption.proofRequestRound} and data ${redemption.proofRequestData}.`);
        assertNotNull(redemption.proofRequestRound);
        assertNotNull(redemption.proofRequestData);
        const proof = await this.context.attestationProvider.obtainPaymentProof(redemption.proofRequestRound, redemption.proofRequestData)
            .catch(e => {
                logger.error(`Error obtaining payment proof for redemption ${redemption.requestId}:`, e);
                return null;
            });
        if (proof === AttestationNotProved.NOT_FINALIZED) {
            logger.info(`Agent ${this.agent.vaultAddress}: proof not yet finalized for redemption ${redemption.requestId} in round ${redemption.proofRequestRound} and data ${redemption.proofRequestData}.`);
            return;
        }
        if (attestationProved(proof)) {
            logger.info(`Agent ${this.agent.vaultAddress} obtained payment proof for redemption ${redemption.requestId} in round ${redemption.proofRequestRound} and data ${redemption.proofRequestData}.`);
            await this.bot.locks.nativeChainLock(this.bot.owner.workAddress).lockAndRun(async () => {
                await this.context.assetManager.confirmRedemptionPayment(web3DeepNormalize(proof), redemption.requestId, { from: this.agent.owner.workAddress });
            });
            redemption = await this.updateRedemption(rootEm, redemption, {
                state: AgentRedemptionState.DONE,
            });
            logger.info(`Agent ${this.agent.vaultAddress} confirmed redemption payment for redemption ${redemption.requestId} with proof ${JSON.stringify(web3DeepNormalize(proof))}.`);
        } else {
            logger.info(`Agent ${this.agent.vaultAddress} cannot obtain payment proof for redemption ${redemption.requestId} in round ${redemption.proofRequestRound} and data ${redemption.proofRequestData}.`);
            // wait for one more round and then reset to state PAID, which will eventually resubmit request
            if (await this.bot.enoughTimePassedToObtainProof(redemption)) {
                await this.notifier.sendRedemptionNoProofObtained(redemption.requestId, redemption.proofRequestRound, redemption.proofRequestData);
                logger.info(`Agent ${this.agent.vaultAddress} will retry obtaining proof of payment for redemption ${redemption.requestId}.`);
                redemption = await this.updateRedemption(rootEm, redemption, {
                    state: AgentRedemptionState.PAID,
                    proofRequestRound: undefined,
                    proofRequestData: undefined,
                });
            }
        }
    }

    /**
     * Load and update redemption object in its own transaction.
     */
    async updateRedemption(rootEm: EM, rd: RedemptionId, modifications: Partial<AgentRedemption>): Promise<AgentRedemption> {
        return await this.bot.runInTransaction(rootEm, async (em) => {
            const redemption = await this.findRedemption(em, rd);
            Object.assign(redemption, modifications);
            return redemption;
        });
    }

    /**
     * Returns redemption by id or requestId from persistent state.
     * @param em entity manager
     * @param instance of AgentRedemption
     */
    async findRedemption(em: EM, rd: RedemptionId) {
        if ("id" in rd) {
            return await em.findOneOrFail(AgentRedemption, { id: rd.id }, { refresh: true });
        } else {
            return await em.findOneOrFail(AgentRedemption, { agentAddress: this.agent.vaultAddress, requestId: rd.requestId }, { refresh: true });
        }
    }
}
