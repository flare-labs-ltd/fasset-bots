import BN from "bn.js";
import { Agent } from "../fasset/Agent";
import { squashSpace } from "../utils/formatting";
import { NEGATIVE_FREE_UNDERLYING_BALANCE_PREVENTION_FACTOR, assertNotNull, toBN } from "../utils/helpers";
import { logger } from "../utils/logger";
import { AgentNotifier } from "../utils/notifier/AgentNotifier";
import { AgentTokenBalances } from "./AgentTokenBalances";
import { EM } from "../config/orm";
import { AgentUnderlyingPayment } from "../entities/agent";
import { FilterQuery, RequiredEntityData } from "@mikro-orm/core";
import { AttestationNotProved } from "../underlying-chain/interfaces/IStateConnectorClient";
import { attestationProved } from "../underlying-chain/AttestationHelper";
import { web3DeepNormalize } from "../utils/web3normalize";
import { AgentUnderlyingPaymentState, AgentUnderlyingPaymentType } from "../entities/common";
export class AgentBotUnderlyingManagement {
    constructor(public agent: Agent, public notifier: AgentNotifier, public ownerUnderlyingAddress: string, public tokens: AgentTokenBalances) {}

    context = this.agent.context;

    /**
     * Checks AgentBot's and owner's underlying balance after redemption is finished. If AgentBot's balance is too low, it tries to top it up from owner's account. See 'underlyingTopUp(...)'.
     * @param agentVault agent's vault address
     */
    async checkUnderlyingBalance(em: EM): Promise<void> {
        logger.info(`Agent ${this.agent.vaultAddress} is checking free underlying balance.`);
        const freeUnderlyingBalance = toBN((await this.agent.getAgentInfo()).freeUnderlyingBalanceUBA);
        logger.info(`Agent's ${this.agent.vaultAddress} free underlying balance is ${freeUnderlyingBalance}.`);
        const estimatedFee = toBN(await this.context.wallet.getTransactionFee());
        logger.info(`Agent's ${this.agent.vaultAddress} calculated estimated underlying fee is ${estimatedFee}.`);
        if (freeUnderlyingBalance.lte(estimatedFee.muln(NEGATIVE_FREE_UNDERLYING_BALANCE_PREVENTION_FACTOR))) {
            await this.underlyingTopUp(em, estimatedFee.muln(NEGATIVE_FREE_UNDERLYING_BALANCE_PREVENTION_FACTOR));
        } else {
            logger.info(`Agent ${this.agent.vaultAddress} doesn't need underlying top up.`);
        }
    }

    /**
     * Tries to top up AgentBot's underlying account from owner's. It notifies about successful and unsuccessful try.
     * It also checks owner's underlying balance and notifies when it is too low.
     * @param amount amount to transfer from owner's underlying address to agent's underlying address
     * @param agentVault agent's vault address
     */
    async underlyingTopUp(em: EM, amount: BN): Promise<void> {
        const amountF = await this.tokens.underlying.format(amount);
        logger.info(squashSpace`Agent ${this.agent.vaultAddress} is trying to top up underlying address ${this.agent.underlyingAddress}
            from owner's underlying address ${this.ownerUnderlyingAddress}.`);
        const txHash = await this.agent.performTopupPayment(amount, this.ownerUnderlyingAddress);
        await this.createAgentUnderlyingPayment(em, txHash, AgentUnderlyingPaymentType.TOP_UP);
        logger.info(squashSpace`Agent ${this.agent.vaultAddress}'s owner sent underlying ${AgentUnderlyingPaymentType.TOP_UP} payment to ${this.agent.underlyingAddress} with amount
            ${amountF} from ${this.ownerUnderlyingAddress} with txHash ${txHash}.`);
        await this.checkForLowOwnerUnderlyingBalance();
    }

    async checkForLowOwnerUnderlyingBalance() {
        const ownerUnderlyingBalance = await this.context.wallet.getBalance(this.ownerUnderlyingAddress);
        const estimatedFee = toBN(await this.context.wallet.getTransactionFee());
        const expectedBalance = this.context.chainInfo.minimumAccountBalance.add(estimatedFee.muln(NEGATIVE_FREE_UNDERLYING_BALANCE_PREVENTION_FACTOR));
        const balanceF = await this.tokens.underlying.format(ownerUnderlyingBalance);
        const expectedBalanceF = await this.tokens.underlying.format(expectedBalance);
        if (ownerUnderlyingBalance.lte(expectedBalance)) {
            await this.notifier.sendLowBalanceOnUnderlyingOwnersAddress(this.ownerUnderlyingAddress, balanceF);
            logger.info(squashSpace`Agent's ${this.agent.vaultAddress} owner ${this.agent.owner.managementAddress} has low balance
                ${balanceF} on underlying address ${this.ownerUnderlyingAddress}. Expected to have at least ${expectedBalanceF}.`);
        } else {
            logger.info(squashSpace`Agent's ${this.agent.vaultAddress} owner ${this.agent.owner.managementAddress} has ${balanceF}
                on underlying address ${this.ownerUnderlyingAddress}.`);
        }
    }

    /**
     * Stores sent underlying payment.
     * @param em entity manager
     * @param type enum for underlying payment type from entity AgentUnderlyingPayment
     */
    async createAgentUnderlyingPayment(em: EM, txHash: string, type: AgentUnderlyingPaymentType): Promise<void> {
        em.create(
            AgentUnderlyingPayment,
            {
                agentAddress: this.agent.vaultAddress,
                state: AgentUnderlyingPaymentState.PAID,
                txHash: txHash,
                type: type,
            } as RequiredEntityData<AgentUnderlyingPayment>,
            { persist: true }
        );
        await this.notifier.sendAgentUnderlyingPaymentCreated(txHash, type);
        logger.info(`Agent ${this.agent.vaultAddress} send underlying ${type} payment ${txHash}.`);
    }

    /**
     * Returns underlying payments with state other than DONE.
     * @param em entity manager
     * @return list of AgentUnderlyingPayment's instances
     */
    async openUnderlyingPaymentIds(em: EM): Promise<AgentUnderlyingPayment[]> {
        const query = em.createQueryBuilder(AgentUnderlyingPayment).select("id");
        return await query
            .where({ agentAddress: this.agent.vaultAddress })
            .andWhere({ $not: { state: AgentUnderlyingPaymentState.DONE } })
            .getResultList();
    }

    /**
     * Handles underlying payment stored in persistent state according to their state.
     * @param rootEm entity manager
     * @param id AgentUnderlyingPayment's entity id
     */
    async nextUnderlyingPaymentStep(rootEm: EM, id: number): Promise<void> {
        await rootEm
            .transactional(async (em) => {
                const underlyingPayment = await em
                    .getRepository(AgentUnderlyingPayment)
                    .findOneOrFail({ id: Number(id) } as FilterQuery<AgentUnderlyingPayment>);
                logger.info(`Agent ${this.agent.vaultAddress} is handling open underlying ${underlyingPayment.type} payment ${underlyingPayment.txHash} in state ${underlyingPayment.state}.`);
                switch (underlyingPayment.state) {
                    case AgentUnderlyingPaymentState.PAID:
                        await this.checkPaymentProofAvailable(underlyingPayment);
                        break;
                    case AgentUnderlyingPaymentState.REQUESTED_PROOF:
                        await this.checkConfirmPayment(underlyingPayment);
                        break;
                    default:
                        console.error(`Underlying payment state: ${underlyingPayment.state} not supported`);
                        logger.error(
                            `Agent ${this.agent.vaultAddress} run into underlying payment state ${underlyingPayment.state} not supported for underlying ${underlyingPayment.type} payment ${underlyingPayment.txHash}.`
                        );
                }
                await em.persistAndFlush(underlyingPayment);
            })
            .catch((error) => {
                console.error(`Error handling next underlying payment step for underlying payment ${id} agent ${this.agent.vaultAddress}: ${error}`);
                logger.error(`Agent ${this.agent.vaultAddress} run into error while handling next underlying payment step for underlying payment ${id}:`, error);
            });
    }

    /**
     * When underlying payment is in state PAID it requests payment proof - see requestPaymentProof().
     * @param underlyingPayment AgentUnderlyingPayment entity
     */
    async checkPaymentProofAvailable(underlyingPayment: AgentUnderlyingPayment): Promise<void> {
        logger.info(
            `Agent ${this.agent.vaultAddress} is checking if payment proof for underlying ${underlyingPayment.type} payment ${underlyingPayment.txHash} is available.`
        );
        assertNotNull(underlyingPayment.txHash);
        const txBlock = await this.context.blockchainIndexer.getTransactionBlock(underlyingPayment.txHash);
        const blockHeight = await this.context.blockchainIndexer.getBlockHeight();
        if (txBlock != null && blockHeight - txBlock.number >= this.context.blockchainIndexer.finalizationBlocks) {
            await this.requestPaymentProof(underlyingPayment);
            await this.notifier.sendAgentUnderlyingPaymentRequestPaymentProof(underlyingPayment.txHash, underlyingPayment.type);
        }
    }

    /**
     * Sends request for underlying payment payment proof, sets state for underlying payment in persistent state to REQUESTED_PROOF.
     * @param underlyingPayment AgentUnderlyingPayment entity
     */
    async requestPaymentProof(underlyingPayment: AgentUnderlyingPayment): Promise<void> {
        logger.info(
            squashSpace`Agent ${this.agent.vaultAddress} is sending request for payment proof for underlying ${underlyingPayment.type} payment ${underlyingPayment.txHash}.`
        );
        assertNotNull(underlyingPayment.txHash);
        const request = await this.context.attestationProvider.requestPaymentProof(
            underlyingPayment.txHash,
            underlyingPayment.type == AgentUnderlyingPaymentType.TOP_UP ? null : this.agent.underlyingAddress,
            underlyingPayment.type == AgentUnderlyingPaymentType.TOP_UP ? this.agent.underlyingAddress : null
        );
        if (request) {
            underlyingPayment.state = AgentUnderlyingPaymentState.REQUESTED_PROOF;
            underlyingPayment.proofRequestRound = request.round;
            underlyingPayment.proofRequestData = request.data;
            logger.info(squashSpace`Agent ${this.agent.vaultAddress} requested payment proof for underlying ${underlyingPayment.type} payment ${underlyingPayment.txHash};
                proofRequestRound ${request.round}, proofRequestData ${request.data}`);
        } else {
            // else cannot prove request yet
            logger.info(
                `Agent ${this.agent.vaultAddress} cannot yet request payment proof for underlying ${underlyingPayment.type} payment ${underlyingPayment.txHash}.`
            );
        }
    }

    /**
     * When underlying payment is in state REQUESTED_PROOF, it obtains payment proof, calls confirmRedemptionPayment and sets the state of underlying payment in persistent state as DONE.
     * If proof expires, sets the state of underlying payment in persistent state as DONE and sends notification to owner.
     * If proof cannot be obtained, it sends notification to owner.
     * @param underlying payment AgentUnderlyingPayment entity
     */
    async checkConfirmPayment(underlyingPayment: AgentUnderlyingPayment): Promise<void> {
        logger.info(
            `Agent ${this.agent.vaultAddress} is trying to obtain payment proof for underlying ${underlyingPayment.type} payment ${underlyingPayment.txHash} in round ${underlyingPayment.proofRequestRound} and data ${underlyingPayment.proofRequestData}.`
        );
        assertNotNull(underlyingPayment.proofRequestRound);
        assertNotNull(underlyingPayment.proofRequestData);
        const proof = await this.context.attestationProvider.obtainPaymentProof(underlyingPayment.proofRequestRound, underlyingPayment.proofRequestData);
        if (proof === AttestationNotProved.NOT_FINALIZED) {
            logger.info(
                `Agent ${this.agent.vaultAddress}: proof not yet finalized for underlying ${underlyingPayment.type} payment ${underlyingPayment.txHash} in round ${underlyingPayment.proofRequestRound} and data ${underlyingPayment.proofRequestData}.`
            );
            return;
        }
        if (attestationProved(proof)) {
            logger.info(
                `Agent ${this.agent.vaultAddress} obtained payment proof for underlying ${underlyingPayment.type} payment ${underlyingPayment.txHash} in round ${underlyingPayment.proofRequestRound} and data ${underlyingPayment.proofRequestData}.`
            );
            const paymentProof = proof;
            if (underlyingPayment.type == AgentUnderlyingPaymentType.TOP_UP) {
                await this.context.assetManager.confirmTopupPayment(web3DeepNormalize(paymentProof), this.agent.vaultAddress, {
                    from: this.agent.owner.workAddress,
                });
            } else {
                await this.context.assetManager.confirmUnderlyingWithdrawal(web3DeepNormalize(paymentProof), this.agent.vaultAddress, {
                    from: this.agent.owner.workAddress,
                });
            }
            underlyingPayment.state = AgentUnderlyingPaymentState.DONE;
            await this.notifier.sendConfirmWithdrawUnderlying(underlyingPayment.type);
            logger.info(
                `Agent ${this.agent.vaultAddress} confirmed underlying ${underlyingPayment.type} payment ${
                    underlyingPayment.txHash
                } with proof ${JSON.stringify(web3DeepNormalize(paymentProof))}.`
            );
        } else {
            logger.info(
                `Agent ${this.agent.vaultAddress} cannot obtain payment proof for underlying ${underlyingPayment.type} payment ${underlyingPayment.txHash} in round ${underlyingPayment.proofRequestRound} and data ${underlyingPayment.proofRequestData}.`
            );
            await this.notifier.sendAgentUnderlyingPaymentNoProofObtained(
                underlyingPayment.txHash,
                underlyingPayment.type,
                underlyingPayment.proofRequestRound,
                underlyingPayment.proofRequestData
            );
        }
    }
}
