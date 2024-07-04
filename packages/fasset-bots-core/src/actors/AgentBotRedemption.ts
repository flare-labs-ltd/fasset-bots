import { ConfirmedBlockHeightExists } from "@flarenetwork/state-connector-protocol";
import { FilterQuery, RequiredEntityData } from "@mikro-orm/core";
import BN from "bn.js";
import { RedemptionDefault, RedemptionPaymentBlocked, RedemptionPaymentFailed, RedemptionPerformed, RedemptionRequested } from "../../typechain-truffle/IIAssetManager";
import { EM } from "../config/orm";
import { AgentRedemption } from "../entities/agent";
import { Agent } from "../fasset/Agent";
import { attestationProved } from "../underlying-chain/AttestationHelper";
import { IBlock } from "../underlying-chain/interfaces/IBlockChain";
import { AttestationNotProved } from "../underlying-chain/interfaces/IStateConnectorClient";
import { EventArgs } from "../utils/events/common";
import { squashSpace } from "../utils/formatting";
import { assertNotNull, toBN } from "../utils/helpers";
import { logger } from "../utils/logger";
import { AgentNotifier } from "../utils/notifier/AgentNotifier";
import { web3DeepNormalize } from "../utils/web3normalize";
import { AgentBot } from "./AgentBot";
import { AgentRedemptionFinalState, AgentRedemptionState } from "../entities/common";

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
    async redemptionStarted(em: EM, request: EventArgs<RedemptionRequested>): Promise<void> {
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
        await this.notifier.sendRedemptionStarted(request.requestId);
        logger.info(`Agent ${this.agent.vaultAddress} started redemption ${request.requestId}.`);
    }

    async redemptionPerformed(em: EM, args: EventArgs<RedemptionPerformed>) {
        const redemption = await this.findRedemption(em, args.requestId);
        redemption.finalState = AgentRedemptionFinalState.PERFORMED;
        await this.redemptionFinished(em, args.requestId);
        await this.notifier.sendRedemptionWasPerformed(args.requestId, args.redeemer);
    }

    async redemptionPaymentFailed(em: EM, args: EventArgs<RedemptionPaymentFailed>) {
        const redemption = await this.findRedemption(em, args.requestId);
        redemption.finalState = AgentRedemptionFinalState.FAILED;
        await this.redemptionFinished(em, args.requestId);
        await this.notifier.sendRedemptionFailed(args.requestId.toString(), args.transactionHash, args.redeemer, args.failureReason);
    }

    async redemptionPaymentBlocked(em: EM, args: EventArgs<RedemptionPaymentBlocked>) {
        const redemption = await this.findRedemption(em, args.requestId);
        redemption.finalState = AgentRedemptionFinalState.BLOCKED;
        await this.redemptionFinished(em, args.requestId);
        await this.notifier.sendRedemptionBlocked(args.requestId.toString(), args.transactionHash, args.redeemer);
    }

    async redemptionDefault(em: EM, args: EventArgs<RedemptionDefault>) {
        const redemption = await this.findRedemption(em, args.requestId);
        redemption.defaulted = true;
        await this.notifier.sendRedemptionDefaulted(args.requestId.toString(), args.redeemer);
    }

    /**
     * Marks stored redemption in persistent state as DONE, then it checks AgentBot's and owner's underlying balance.
     * @param em entity manager
     * @param requestId redemption request id
     * @param agentVault agent's vault address
     */
    async redemptionFinished(em: EM, requestId: BN): Promise<void> {
        const redemption = await this.findRedemption(em, requestId);
        redemption.state = AgentRedemptionState.DONE;
        logger.info(`Agent ${this.agent.vaultAddress} closed redemption ${requestId}.`);
        await this.bot.underlyingManagement.checkUnderlyingBalance(em);
    }

    /**
     * Returns redemption by required id from persistent state.
     * @param em entity manager
     * @param requestId redemption request id
     * @param instance of AgentRedemption
     */
    async findRedemption(em: EM, requestId: BN): Promise<AgentRedemption> {
        const agentAddress = this.agent.vaultAddress;
        return await em.findOneOrFail(AgentRedemption, { agentAddress, requestId } as FilterQuery<AgentRedemption>);
    }

    /**
     * Returns minting with state other than DONE.
     * If there are too many redemptions, prioritize those in state STARTED.
     * @param em entity manager
     * @param onlyIds if true, only AgentRedemption's entity ids are return
     * * @return list of AgentRedemption's instances
     */
    async openRedemptions(em: EM, onlyIds: boolean): Promise<AgentRedemption[]> {
        let query = em.createQueryBuilder(AgentRedemption);
        if (onlyIds) query = query.select(["id", "state"]);
        const list = await query
            .where({ agentAddress: this.agent.vaultAddress })
            .andWhere({ $not: { state: AgentRedemptionState.DONE } })
            .getResultList();
        const getPriority = (rd: AgentRedemption) => this.handlingPriorityDict[rd.state] ?? 1000;
        list.sort((a, b) => getPriority(a) - getPriority(b));
        // return all in state started plus handleMaxNonPriorityRedemptions at most
        let count = 0;
        while (count < list.length && list[count].state === AgentRedemptionState.STARTED) count++;
        return list.slice(0, count + this.handleMaxNonPriorityRedemptions);
    }

    handlingPriorityDict: Partial<Record<AgentRedemptionState, number>> = {
        [AgentRedemptionState.STARTED]: 0,
        [AgentRedemptionState.REQUESTED_REJECTION_PROOF]: 1,
        [AgentRedemptionState.PAID]: 2,
        [AgentRedemptionState.REQUESTED_PROOF]: 2,
    }

    /**
     * Handles redemptions stored in persistent state according to their state.
     * @param rootEm entity manager
     * @param id AgentRedemption's entity id
     */
    async nextRedemptionStep(rootEm: EM, id: number): Promise<void> {
        await rootEm
            .transactional(async (em) => {
                const redemption = await em.getRepository(AgentRedemption).findOneOrFail({ id: Number(id) } as FilterQuery<AgentRedemption>);
                logger.info(`Agent ${this.agent.vaultAddress} is handling open redemption ${redemption.requestId} in state ${redemption.state}.`);
                await this.handleOpenRedemption(redemption);
                await em.persistAndFlush(redemption);
            })
            .catch((error) => {
                console.error(`Error handling next redemption step for redemption ${id} agent ${this.agent.vaultAddress}: ${error}`);
                logger.error(`Agent ${this.agent.vaultAddress} run into error while handling handling next redemption step for redemption ${id}:`, error);
            });
    }

    async redemptionExpirationProof(rd: AgentRedemption) {
        return await this.bot.checkProofExpiredInIndexer(toBN(rd.lastUnderlyingBlock), toBN(rd.lastUnderlyingTimestamp));
    }

    async handleOpenRedemption(redemption: AgentRedemption) {
        // speedup - never need to expire redemption in state STARTED
        if (redemption.state !== AgentRedemptionState.STARTED) {
            const expirationProof = await this.redemptionExpirationProof(redemption);
            if (typeof expirationProof === "object") {
                await this.handleExpiredRedemption(redemption, expirationProof);
                return;
            }
        }
        // redemption hasn't expired yet
        switch (redemption.state) {
            case AgentRedemptionState.STARTED:
                await this.checkBeforeRedemptionPayment(redemption);
                break;
            case AgentRedemptionState.PAYING:
                // payment failed, do nothing for now
                // later we could check the state on chain / in mempool and if there is nothing, retry
                break;
            case AgentRedemptionState.UNPAID:
                // bot didn't manage to pay in time - do nothing and it will be expired after 24h
                break;
            case AgentRedemptionState.PAID:
                await this.checkPaymentProofAvailable(redemption);
                break;
            case AgentRedemptionState.REQUESTED_PROOF:
                await this.checkConfirmPayment(redemption);
                break;
            case AgentRedemptionState.REQUESTED_REJECTION_PROOF:
                await this.checkRejectRedemption(redemption);
                break;
            default:
                console.error(`Redemption state: ${redemption.state} not supported`);
                logger.error(`Agent ${this.agent.vaultAddress} run into redemption state ${redemption.state} not supported for redemption ${redemption.requestId}.`);
        }
    }

    // temp disabled
    async handleExpiredRedemption(rd: AgentRedemption, proof: ConfirmedBlockHeightExists.Proof) {
        logger.info(`Agent ${this.agent.vaultAddress} found expired unpaid redemption ${rd.requestId} and is calling 'finishRedemptionWithoutPayment'.`);
        // corner case - agent did not pay
        await this.context.assetManager.finishRedemptionWithoutPayment(web3DeepNormalize(proof), rd.requestId, { from: this.agent.owner.workAddress });
        rd.state = AgentRedemptionState.DONE;
        rd.finalState = AgentRedemptionFinalState.EXPIRED;
        await this.notifier.sendRedemptionExpiredInIndexer(rd.requestId);
        logger.info(`Agent ${this.agent.vaultAddress} closed redemption ${rd.requestId}.`);
    }

    /**
     * When redemption is in state STARTED, it checks if payment can be done in time.
     * Then it performs payment and sets the state of redemption in persistent state as PAID.
     * @param redemption AgentRedemption entity
     */
    async checkBeforeRedemptionPayment(redemption: AgentRedemption): Promise<void> {
        const blockHeight = await this.context.blockchainIndexer.getBlockHeight();
        const lastBlock = await this.context.blockchainIndexer.getBlockAt(blockHeight);
        /* istanbul ignore else */
        if (lastBlock && this.stillTimeToPayForRedemption(lastBlock, redemption)) {
            const validation = await this.context.verificationClient.checkAddressValidity(this.context.chainInfo.chainId.sourceId, redemption.paymentAddress);
            if (validation.isValid && validation.standardAddress === redemption.paymentAddress) {
                await this.payForRedemption(redemption);
            } else {
                await this.startRejectRedemption(redemption);
            }
        } else if (lastBlock) {
            logger.info(squashSpace`Agent ${this.agent.vaultAddress} DID NOT pay for redemption ${redemption.requestId}.
                Time expired on underlying chain. Last block for payment was ${redemption.lastUnderlyingBlock}
                with timestamp ${redemption.lastUnderlyingTimestamp}. Current block is ${lastBlock.number}
                with timestamp ${lastBlock.timestamp}.`);
            redemption.state = AgentRedemptionState.UNPAID;
        } else {
            logger.info(`Agent ${this.agent.vaultAddress} could not retrieve last block in checkBeforeRedemptionPayment for ${redemption.requestId}.`);
        }
    }

    async payForRedemption(redemption: AgentRedemption) {
        logger.info(`Agent ${this.agent.vaultAddress} is trying to pay for redemption ${redemption.requestId}.`);
        const paymentAmount = toBN(redemption.valueUBA).sub(toBN(redemption.feeUBA));
        // !!! TODO: this is a hack, setting state to PAYING should be in separate transaction.
        // Also, this may increase number of unpaid redemptions (but it prevents full liquidation).
        // Better solution should be found.
        redemption.state = AgentRedemptionState.PAYING;
        try {
            // TODO: what if there are too little funds on underlying address to pay for fee?
            const txHash = await this.agent.performPayment(redemption.paymentAddress, paymentAmount, redemption.paymentReference);
            redemption.txHash = txHash;
            redemption.state = AgentRedemptionState.PAID;
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

    async startRejectRedemption(redemption: AgentRedemption) {
        logger.info(squashSpace`Agent ${this.agent.vaultAddress} is sending request for payment address invalidity
            for redemption ${redemption.requestId} and address ${redemption.paymentAddress}.`);
        const request = await this.context.attestationProvider.requestAddressValidityProof(redemption.paymentAddress);
        if (request) {
            redemption.state = AgentRedemptionState.REQUESTED_REJECTION_PROOF;
            redemption.proofRequestRound = request.round;
            redemption.proofRequestData = request.data;
            logger.info(squashSpace`Agent ${this.agent.vaultAddress} requested payment proof for payment address invalidity
                for redemption ${redemption.requestId} and address ${redemption.paymentAddress},
                proofRequestRound ${request.round}, proofRequestData ${request.data}`);
        } else {
            // else cannot prove request yet
            logger.info(squashSpace`Agent ${this.agent.vaultAddress} cannot request payment proof for payment address invalidity
                for redemption ${redemption.requestId} and address ${redemption.paymentAddress}.`);
        }
    }

    async checkRejectRedemption(redemption: AgentRedemption): Promise<void> {
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
                await this.context.assetManager.rejectInvalidRedemption(web3DeepNormalize(proof), redemption.requestId, { from: this.agent.owner.workAddress });
                redemption.state = AgentRedemptionState.DONE;
                redemption.finalState = AgentRedemptionFinalState.REJECTED;
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
            const oneMoreRoundFinalized = await this.context.attestationProvider.stateConnector.roundFinalized(redemption.proofRequestRound + 1);
            if (oneMoreRoundFinalized) {
                await this.notifier.sendRedemptionAddressValidationNoProof(redemption.requestId,
                    redemption.proofRequestRound, redemption.proofRequestData, redemption.paymentAddress);
                logger.info(`Agent ${this.agent.vaultAddress} will retry obtaining address validation proof for redemption ${redemption.requestId}.`);
                redemption.state = AgentRedemptionState.STARTED;
                redemption.proofRequestRound = undefined;
                redemption.proofRequestData = undefined;
            }
        }
    }

    /**
     * Checks if redemption payment can be made in time (as specified in redemption event).
     * @param lastBlock
     * @param redemption
     * @returns
     */
    stillTimeToPayForRedemption(lastBlock: IBlock, redemption: AgentRedemption): boolean {
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
    async checkPaymentProofAvailable(redemption: AgentRedemption): Promise<void> {
        logger.info(`Agent ${this.agent.vaultAddress} is checking if payment proof for redemption ${redemption.requestId} is available.`);
        assertNotNull(redemption.txHash);
        const txBlock = await this.context.blockchainIndexer.getTransactionBlock(redemption.txHash);
        const blockHeight = await this.context.blockchainIndexer.getBlockHeight();
        if (txBlock != null && blockHeight - txBlock.number >= this.context.blockchainIndexer.finalizationBlocks) {
            await this.requestPaymentProof(redemption);
            await this.notifier.sendRedemptionRequestPaymentProof(redemption.requestId.toString());
        }
    }

    /**
     * Sends request for redemption payment proof, sets state for redemption in persistent state to REQUESTED_PROOF.
     * @param redemption AgentRedemption entity
     */
    async requestPaymentProof(redemption: AgentRedemption): Promise<void> {
        logger.info(squashSpace`Agent ${this.agent.vaultAddress} is sending request for payment proof transaction ${redemption.txHash}
            and redemption ${redemption.requestId}.`);
        assertNotNull(redemption.txHash);
        const request = await this.context.attestationProvider.requestPaymentProof(redemption.txHash, this.agent.underlyingAddress, redemption.paymentAddress);
        if (request) {
            redemption.state = AgentRedemptionState.REQUESTED_PROOF;
            redemption.proofRequestRound = request.round;
            redemption.proofRequestData = request.data;
            logger.info(squashSpace`Agent ${this.agent.vaultAddress} requested payment proof for transaction ${redemption.txHash}
                and redemption ${redemption.requestId}; target underlying address ${redemption.paymentAddress},
                proofRequestRound ${request.round}, proofRequestData ${request.data}`);
        } else {
            // else cannot prove request yet
            logger.info(`Agent ${this.agent.vaultAddress} cannot yet request payment proof for transaction ${redemption.txHash} and redemption ${redemption.requestId}.`);
        }
    }

    /**
     * When redemption is in state REQUESTED_PROOF, it obtains payment proof, calls confirmRedemptionPayment and sets the state of redemption in persistent state as DONE.
     * If proof expired (corner case), it calls finishRedemptionWithoutPayment, sets the state of redemption in persistent state as DONE and send notification to owner.
     * If proof cannot be obtained, it sends notification to owner.
     * @param redemption AgentRedemption entity
     */
    async checkConfirmPayment(redemption: AgentRedemption): Promise<void> {
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
            const paymentProof = proof;
            await this.context.assetManager.confirmRedemptionPayment(web3DeepNormalize(paymentProof), redemption.requestId, { from: this.agent.owner.workAddress });
            redemption.state = AgentRedemptionState.DONE;
            logger.info(`Agent ${this.agent.vaultAddress} confirmed redemption payment for redemption ${redemption.requestId} with proof ${JSON.stringify(web3DeepNormalize(paymentProof))}.`);
        } else {
            logger.info(`Agent ${this.agent.vaultAddress} cannot obtain payment proof for redemption ${redemption.requestId} in round ${redemption.proofRequestRound} and data ${redemption.proofRequestData}.`);
            // wait for one more round and then reset to state PAID, which will eventually resubmit request
            const oneMoreRoundFinalized = await this.context.attestationProvider.stateConnector.roundFinalized(redemption.proofRequestRound + 1);
            if (oneMoreRoundFinalized) {
                await this.notifier.sendRedemptionNoProofObtained(redemption.requestId, redemption.proofRequestRound, redemption.proofRequestData);
                logger.info(`Agent ${this.agent.vaultAddress} will retry obtaining proof of payment for redemption ${redemption.requestId}.`);
                redemption.state = AgentRedemptionState.PAID;
                redemption.proofRequestRound = undefined;
                redemption.proofRequestData = undefined;
            }
        }
    }
}
