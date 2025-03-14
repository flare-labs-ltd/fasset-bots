import { ConfirmedBlockHeightExists } from "@flarenetwork/state-connector-protocol";
import { RequiredEntityData } from "@mikro-orm/core";
import BN from "bn.js";
import { RedemptionDefault, RedemptionPaymentBlocked, RedemptionPaymentFailed, RedemptionPerformed, RedemptionRequested, RedemptionRequestRejected, RedemptionRequestTakenOver } from "../../typechain-truffle/IIAssetManager";
import { EM } from "../config/orm";
import { AgentRedemption, RejectedRedemptionRequest } from "../entities/agent";
import { AgentRedemptionFinalState, AgentRedemptionState, RejectedRedemptionRequestState } from "../entities/common";
import { Agent } from "../fasset/Agent";
import { AttestationHelperError, attestationProved } from "../underlying-chain/AttestationHelper";
import { IBlock } from "../underlying-chain/interfaces/IBlockChain";
import { AttestationNotProved } from "../underlying-chain/interfaces/IFlareDataConnectorClient";
import { EventArgs } from "../utils/events/common";
import { squashSpace } from "../utils/formatting";
import { assertNotNull, BN_ZERO, BNish, errorIncluded, MAX_BIPS, messageForExpectedError, requireNotNull, toBN, UTXO_BLOCK_SIZE_IN_KB } from "../utils/helpers";
import { logger } from "../utils/logger";
import { AgentNotifier } from "../utils/notifier/AgentNotifier";
import { web3DeepNormalize } from "../utils/web3normalize";
import { AgentBot } from "./AgentBot";
import { TransactionStatus } from "@flarelabs/simple-wallet";
import { lastFinalizedUnderlyingBlock, maxFeeMultiplier } from "../utils/fasset-helpers";
import { AddressCheck } from "./AgentBotHandshake";
import { blockTimestamp, latestBlockTimestamp } from "../utils/web3helpers";

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
                    redeemerAddress: request.redeemer,
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

    async redemptionRequestRejected(rootEm: EM, args: EventArgs<RedemptionRequestRejected>, blockNumber: number) {
        const thisAgent = args.agentVault.toLowerCase() === this.agent.vaultAddress.toLowerCase();
        await this.bot.runInTransaction(rootEm, async (em) => {
            const rejectedRedemptionRequest = em.create(
                RejectedRedemptionRequest,
                {
                    state: thisAgent ? RejectedRedemptionRequestState.DONE : RejectedRedemptionRequestState.STARTED,
                    agentAddress: this.agent.vaultAddress,
                    requestId: toBN(args.requestId),
                    redeemerAddress: args.redeemer,
                    paymentAddress: args.paymentAddress,
                    valueUBA: toBN(args.valueUBA),
                    rejectionBlockNumber: blockNumber,
                } as RequiredEntityData<RejectedRedemptionRequest>,
                { persist: true }
            );
            if (thisAgent) {
                const redemption = await this.findRedemption(em, { requestId: toBN(args.requestId) });
                redemption.state = AgentRedemptionState.REJECTED;
                redemption.rejectedRedemptionRequest = rejectedRedemptionRequest;
            }
        });
    }

    async redemptionRequestTakenOver(rootEm: EM, args: EventArgs<RedemptionRequestTakenOver>) {
        const oldAgent = args.agentVault.toLowerCase() === this.agent.vaultAddress.toLowerCase();
        const newAgent = args.newAgentVault.toLowerCase() === this.agent.vaultAddress.toLowerCase();
        await this.bot.runInTransaction(rootEm, async (em) => {
            const rejectedRedemptionRequest = await this.findRejectedRedemptionRequest(em, { requestId: toBN(args.requestId) });
            if (rejectedRedemptionRequest == null) {
                if (oldAgent || newAgent) {
                    throw new Error(`Rejected redemption request not found for redemption ${args.requestId}`);
                }
                return; // just ignore as agent bot was started after the rejection
            }
            rejectedRedemptionRequest.valueTakenOverUBA = rejectedRedemptionRequest.valueTakenOverUBA.add(toBN(args.valueTakenOverUBA));
            if (oldAgent && rejectedRedemptionRequest.valueTakenOverUBA.gte(rejectedRedemptionRequest.valueUBA)) {
                // we are the agent who rejected the request but whole request was already taken over, mark as done
                const redemption = await this.findRedemption(em, { requestId: toBN(args.requestId) });
                redemption.state = AgentRedemptionState.DONE;
                redemption.finalState = AgentRedemptionFinalState.HANDSHAKE_REJECTED;
            } else if (newAgent) {
                // we are the new agent taking over the request, set rejectedRedemptionRequest
                const redemption = await this.findRedemption(em, { requestId: toBN(args.newRequestId) });
                redemption.rejectedRedemptionRequest = rejectedRedemptionRequest;
            }
        });
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
        await this.bot.runInTransaction(rootEm, async (em) => {
            const redemption = await this.findRedemption(em, { requestId: toBN(args.requestId) });
            redemption.defaulted = true;
            if (redemption.state === AgentRedemptionState.UNPAID || redemption.state === AgentRedemptionState.REJECTED) {
                redemption.finalState = this.getFinalState(redemption);
                redemption.state = AgentRedemptionState.DONE;
            }
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
            /* istanbul ignore next */
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
        /* istanbul ignore next */
        if (this.bot.stopRequested()) return;
        const redemptions = await this.expiredRedemptions(rootEm, expirationProof, batchSize);
        const proof = expirationProof.data.responseBody;
        logger.info(squashSpace`Agent ${this.agent.vaultAddress} is handling ${redemptions.length} expired redemptions
            (lqwBlock=${proof.lowestQueryWindowBlockNumber}, lqwTimestamp=${proof.lowestQueryWindowBlockTimestamp})`);
        for (const redemption of redemptions) {
            /* istanbul ignore next */
            if (this.bot.stopRequested()) return;
            try {
                await this.handleExpiredRedemption(rootEm, redemption, expirationProof);
            } catch (error) {
                logger.error(`Error expiring redemption ${redemption.requestId}`, error);
            }
        }
    }

    /**
     * Returns redemptions in given state.
     * @param rootEm entity manager
     * @param state AgentRedemptionState
     * @param limit max number of redemptions to return
     * @return list of AgentRedemption's instances
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
                // mark payment initiated
                break;
            case AgentRedemptionState.REJECTED:
                // bot rejected redemption - other agents can now take over, if they don't, do nothing and it will be expired after 24h
                break;
            case AgentRedemptionState.REJECTING:
                // bot rejected poolSelfClose redemption or didn't manage to reject in time  - do nothing and it will be expired after 24h
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
        let finalState: AgentRedemptionFinalState | undefined;
        try {
            await this.bot.locks.nativeChainLock(this.bot.owner.workAddress).lockAndRun(async () => {
                await this.context.assetManager.finishRedemptionWithoutPayment(web3DeepNormalize(proof), redemption.requestId, { from: this.agent.owner.workAddress });
            });
        } catch (error) {
            if (errorIncluded(error, ["invalid request id"])) {
                logger.warn(`Redemption ${redemption.requestId} doesn't exist any more, probably it has been confirmed by a 3rd party.`)
                finalState = AgentRedemptionFinalState.EXTERNALLY_CONFIRMED;
            } else {
                throw error;
            }
        }
        redemption = await this.updateRedemption(rootEm, redemption, {
            state: AgentRedemptionState.DONE,
            finalState: finalState ?? this.getFinalState(redemption),
        });
        await this.notifier.sendRedemptionExpiredInIndexer(redemption.requestId);
        logger.info(`Agent ${this.agent.vaultAddress} closed redemption ${redemption.requestId} in state ${redemption.finalState}.`);
    }

    private getFinalState(redemption: Readonly<AgentRedemption>): AgentRedemptionFinalState | undefined {
        switch (redemption.state) {
            case AgentRedemptionState.PAYING:
                return AgentRedemptionFinalState.EXPIRED_PAYING;
            case AgentRedemptionState.PAID:
            case AgentRedemptionState.REQUESTED_PROOF:
                return AgentRedemptionFinalState.EXPIRED_PAID;
            case AgentRedemptionState.REJECTING:
            case AgentRedemptionState.REJECTED:
                return AgentRedemptionFinalState.HANDSHAKE_REJECTED;
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
        const lastFinalizedBlock = await lastFinalizedUnderlyingBlock(this.context.blockchainIndexer);
        if (this.stillTimeToPayForRedemption(lastFinalizedBlock, redemption)) {
            if (await this.redeemerAddressValid(redemption.paymentAddress)) {
                await this.payOrRejectRedemption(rootEm, redemption);
            } else {
                await this.startRejectRedemption(rootEm, redemption);
            }
        } else {
            logger.info(squashSpace`Agent ${this.agent.vaultAddress} DID NOT pay for redemption ${redemption.requestId}.
                Time expired on underlying chain. Last block for payment was ${redemption.lastUnderlyingBlock}
                with timestamp ${redemption.lastUnderlyingTimestamp}. Current block is ${lastFinalizedBlock.number}
                with timestamp ${lastFinalizedBlock.timestamp}.`);
            redemption = await this.updateRedemption(rootEm, redemption, {
                state: AgentRedemptionState.UNPAID,
            });
        }
    }

    async payOrRejectRedemption(rootEm: EM, redemption: Readonly<AgentRedemption>) {
        if (redemption.rejectedRedemptionRequest == null) { // check only if not taken over
            const settings = await this.agent.getAgentSettings();
            if (settings.handshakeType.toString() !== "0") {
                logger.info(`Agent ${this.agent.vaultAddress} is handling redemption ${redemption.requestId} handshake check.`);
                // check if redeemer address and redeemer underlying address are not sanctioned
                const addressesOk = await this.bot.handshake.checkSanctionedAddresses([
                    new AddressCheck(redemption.redeemerAddress, this.context.nativeChainInfo.chainName),
                    new AddressCheck(redemption.paymentAddress, this.context.chainInfo.chainId.chainName),
                ]);
                if (!addressesOk) {
                    redemption = await this.updateRedemption(rootEm, redemption, {
                        state: AgentRedemptionState.REJECTING,
                    });
                    try {
                        logger.info(`Agent ${this.agent.vaultAddress} is trying to reject redemption ${redemption.requestId}.`);
                        await this.bot.locks.nativeChainLock(this.bot.owner.workAddress).lockAndRun(async () => {
                            await this.context.assetManager.rejectRedemptionRequest(redemption.requestId, { from: this.agent.owner.workAddress });
                        });
                        await this.notifier.sendRedemptionRejected(redemption.requestId);
                        logger.info(`Agent ${this.agent.vaultAddress} rejected redemption ${redemption.requestId}.`);
                    } catch (error) {
                        logger.error(`Error trying to reject redemption ${redemption.requestId}:`, error);
                        await this.notifier.sendRedemptionRejectionFailed(redemption.requestId);
                    }
                    return;
                }
            }
        }

        logger.info(`Agent ${this.agent.vaultAddress} is trying to pay for redemption ${redemption.requestId}.`);
        const redemptionFee = toBN(redemption.feeUBA);
        const paymentAmount = toBN(redemption.valueUBA).sub(redemptionFee);
        const blocksToFill = Number((await this.agent.assetManager.getSettings()).underlyingBlocksForPayment);
        const minFeePerKB = paymentAmount.muln(this.bot.agentBotSettings.feeSafetyFactorPerKB).divn(UTXO_BLOCK_SIZE_IN_KB * blocksToFill);
        const redemptionPoolFeeShareBIPS = toBN(await this.agent.getAgentSetting("redemptionPoolFeeShareBIPS"));
        const poolFeeUBA = redemptionFee.mul(redemptionPoolFeeShareBIPS).divn(MAX_BIPS);
        let maxRedemptionFee = redemptionFee.sub(poolFeeUBA);
        if (maxRedemptionFee.eq(BN_ZERO)) {
            const coreVaultSourceAddress = await requireNotNull(this.context.coreVaultManager).coreVaultAddress();
            if (redemption.paymentAddress === coreVaultSourceAddress) {
                const currentFee = await this.context.wallet.getTransactionFee({source: this.agent.underlyingAddress, destination: redemption.paymentAddress, isPayment: true, amount: redemption.valueUBA});
                maxRedemptionFee = currentFee.muln(2);
            }
        }

        redemption = await this.updateRedemption(rootEm, redemption, {
            state: AgentRedemptionState.PAYING,
        });
        try {
            const txDbId = await this.bot.locks.underlyingLock(this.agent.underlyingAddress).lockAndRun(async () => {
                const feeSourceAddress = this.context.chainInfo.useOwnerUnderlyingAddressForPayingFees ? this.bot.ownerUnderlyingAddress : undefined;
                return await this.agent.initiatePayment(redemption.paymentAddress, paymentAmount, redemption.paymentReference, undefined, {
                    maxFee: maxRedemptionFee.muln(maxFeeMultiplier(this.context.chainInfo.chainId)),
                    minFeePerKB: minFeePerKB,
                    executeUntilBlock: redemption.lastUnderlyingBlock,
                    executeUntilTimestamp: redemption.lastUnderlyingTimestamp,
                    isFreeUnderlying: false,
                    feeSourceAddress: feeSourceAddress
                });
            });
            redemption = await this.updateRedemption(rootEm, redemption, {
                txDbId: txDbId,
                state: AgentRedemptionState.PAID,
            });
            await this.notifier.sendRedemptionPaid(redemption.requestId);
            logger.info(squashSpace`Agent ${this.agent.vaultAddress} initiated payment for redemption ${redemption.requestId}
                with txDbId ${txDbId}; target underlying address ${redemption.paymentAddress}, payment reference
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
        const blocksToCurrent = this.context.blockchainIndexer.finalizationBlocks + 1;
        const currentBlockNumberEstimate = lastBlock.number + blocksToCurrent;
        const currentTimestampEstimate = lastBlock.timestamp + blocksToCurrent * this.context.blockchainIndexer.secondsPerBlock;
        return toBN(currentBlockNumberEstimate).lt(toBN(redemption.lastUnderlyingBlock)) ||
            toBN(currentTimestampEstimate).lt(toBN(redemption.lastUnderlyingTimestamp));
    }

    /**
     * When redemption is in state PAID it requests payment proof - see requestPaymentProof().
     * @param redemption AgentRedemption entity
     */
    async checkPaymentProofAvailable(rootEm: EM, redemption: Readonly<AgentRedemption>): Promise<void> {
        logger.info(`Agent ${this.agent.vaultAddress} is checking if payment proof for redemption ${redemption.requestId} is available.`);
        assertNotNull(redemption.txDbId);
        const info = await this.context.wallet.checkTransactionStatus(redemption.txDbId);
        if (info.status == TransactionStatus.TX_SUCCESS || info.status == TransactionStatus.TX_FAILED) {
            if (info.transactionHash) {
                redemption = await this.updateRedemption(rootEm, redemption, {
                    txHash: info.transactionHash
                });
                assertNotNull(redemption.txHash);
                if (await this.bot.underlyingTransactionFinalized(redemption.txHash)) {
                    await this.requestPaymentProof(rootEm, redemption);
                    await this.notifier.sendRedemptionRequestPaymentProof(redemption.requestId.toString());
                }
            }
        } else if (info.status == TransactionStatus.TX_REPLACED && (
            info.replacedByStatus == TransactionStatus.TX_SUCCESS || info.replacedByStatus == TransactionStatus.TX_FAILED
        )) {
            if (info.replacedByHash) {
                redemption = await this.updateRedemption(rootEm, redemption, {
                    txHash: info.replacedByHash
                });
                assertNotNull(redemption.txHash);
                if (await this.bot.underlyingTransactionFinalized(redemption.txHash)) {
                    await this.requestPaymentProof(rootEm, redemption);
                    await this.notifier.sendRedemptionRequestPaymentProof(redemption.requestId.toString());
                }
            }
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
            try {
                await this.bot.locks.nativeChainLock(this.bot.owner.workAddress).lockAndRun(async () => {
                    await this.context.assetManager.confirmRedemptionPayment(web3DeepNormalize(proof), redemption.requestId, { from: this.agent.owner.workAddress });
                });
            } catch (error) {
                if (errorIncluded(error, ["invalid request id"])) {
                    logger.warn(`Redemption ${redemption.requestId} doesn't exist any more, probably it has been confirmed by a 3rd party.`)
                } else {
                    throw error;
                }
            }
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

    async handleRejectedRedemptionRequests(rootEm: EM, batchSize: number = REDEMPTION_BATCH) {
        const rejectedRedemptionRequests = await rootEm.createQueryBuilder(RejectedRedemptionRequest)
            .where({
                agentAddress: this.agent.vaultAddress,
                state: RejectedRedemptionRequestState.STARTED
            })
            .limit(batchSize)
            .getResultList();
        logger.info(`Agent ${this.agent.vaultAddress} is handling ${rejectedRedemptionRequests.length} rejected redemption requests.`);
        if (rejectedRedemptionRequests.length === 0) return;

        const settings = await this.context.assetManager.getSettings();
        const agentSettings = await this.agent.getAgentSettings();

        for (const request of rejectedRedemptionRequests) {
            await this.updateRejectedRedemptionRequest(rootEm, request, { state: RejectedRedemptionRequestState.DONE });

            if (request.valueTakenOverUBA.gte(request.valueUBA)) {
                continue; // request already taken over
            }

            const info = await this.agent.getAgentInfo();
            if (toBN(info.mintedUBA).eq(BN_ZERO)) {
                continue; // agent has no tickets, so cannot take over
            }

            const rejectionTimestamp = await blockTimestamp(request.rejectionBlockNumber);
            const latestTimestamp = await latestBlockTimestamp();
            if (rejectionTimestamp + toBN(settings.takeOverRedemptionRequestWindowSeconds).toNumber() <= latestTimestamp) {
                continue; // take over window closed
            }

            if (agentSettings.handshakeType.toString() !== "0") { // handshake enabled
                // check if redeemer address and redeemer underlying address are not sanctioned
                const addressesOk = await this.bot.handshake.checkSanctionedAddresses([
                    new AddressCheck(request.redeemerAddress, this.context.nativeChainInfo.chainName),
                    new AddressCheck(request.paymentAddress, this.context.chainInfo.chainId.chainName),
                ]);
                if (!addressesOk) {
                    continue; // addresses are sanctioned - do not take over
                }
            }

            try {
                logger.info(`Agent ${this.agent.vaultAddress} is trying to take over rejected redemption ${request.requestId}.`);
                await this.bot.locks.nativeChainLock(this.bot.owner.workAddress).lockAndRun(async () => {
                    await this.context.assetManager.takeOverRedemptionRequest(this.agent.vaultAddress, request.requestId, { from: this.agent.owner.workAddress });
                });
                await this.notifier.sendRedemptionTakenOver(request.requestId);
                logger.info(`Agent ${this.agent.vaultAddress} take over rejected redemption ${request.requestId}.`);
            } catch (error) {
                if (errorIncluded(error, ["invalid request id", "not active", "take over redemption request window closed", "no tickets"])) {
                    logger.info(`Agent ${this.agent.vaultAddress} failed to take over rejected redemption ${request.requestId} as it is no longer available or there were no tickets left.`);
                } else {
                    logger.error(`Error trying to take over rejected redemption ${request.requestId}:`, error);
                    await this.notifier.sendRedemptionTakeoverFailed(request.requestId);
                }
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
            return await em.findOneOrFail(AgentRedemption, { id: rd.id }, { refresh: true, populate: ["rejectedRedemptionRequest"] });
        } else {
            return await em.findOneOrFail(AgentRedemption, { agentAddress: this.agent.vaultAddress, requestId: rd.requestId }, { refresh: true, populate: ["rejectedRedemptionRequest"] });
        }
    }

     /**
     * Load and update rejected redemption request object in its own transaction.
     */
     async updateRejectedRedemptionRequest(rootEm: EM, rd: RedemptionId, modifications: Partial<RejectedRedemptionRequest>): Promise<RejectedRedemptionRequest> {
        return await this.bot.runInTransaction(rootEm, async (em) => {
            const redemption = await this.findRejectedRedemptionRequest(em, rd);
            if (redemption == null) throw new Error(`Rejected redemption request not found for redemption ${rd}`);
            Object.assign(redemption, modifications);
            return redemption;
        });
}

    /**
     * Returns rejected redemption request by id or requestId from persistent state.
     * @param em entity manager
     * @param instance of AgentRedemption
     */
    async findRejectedRedemptionRequest(em: EM, rd: RedemptionId) {
        if ("id" in rd) {
            return await em.findOne(RejectedRedemptionRequest, { id: rd.id }, { refresh: true });
        } else {
            return await em.findOne(RejectedRedemptionRequest, { agentAddress: this.agent.vaultAddress, requestId: rd.requestId }, { refresh: true });
        }
    }
}
