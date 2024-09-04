import { RequiredEntityData } from "@mikro-orm/core";
import BN from "bn.js";
import { AgentBotSettings } from "../config";
import { EM } from "../config/orm";
import { AgentUnderlyingPayment } from "../entities/agent";
import { AgentUnderlyingPaymentState, AgentUnderlyingPaymentType } from "../entities/common";
import { Agent } from "../fasset/Agent";
import { AttestationHelperError, attestationProved } from "../underlying-chain/AttestationHelper";
import { AttestationNotProved } from "../underlying-chain/interfaces/IStateConnectorClient";
import { squashSpace } from "../utils/formatting";
import { assertNotNull, messageForExpectedError, toBN } from "../utils/helpers";
import { logger } from "../utils/logger";
import { AgentNotifier } from "../utils/notifier/AgentNotifier";
import { web3DeepNormalize } from "../utils/web3normalize";
import { AgentBot } from "./AgentBot";
import { AgentTokenBalances } from "./AgentTokenBalances";
import { TransactionStatus } from "@flarelabs/simple-wallet";

export class AgentBotUnderlyingManagement {
    static deepCopyWithObjectCreate = true;

    constructor(
        public bot: AgentBot,
        public agent: Agent,
        public agentBotSettings: AgentBotSettings,
        public notifier: AgentNotifier,
        public ownerUnderlyingAddress: string,
        public tokens: AgentTokenBalances
    ) {}

    context = this.agent.context;

    /**
     * Checks AgentBot's and owner's underlying balance after redemption is finished.
     * If AgentBot's balance is too low, it tries to top it up from owner's account. See 'underlyingTopUp(...)'.
     * @param agentVault agent's vault address
     */
    async checkUnderlyingBalanceAndTopup(em: EM): Promise<void> {
        logger.info(`Agent ${this.agent.vaultAddress} is checking free underlying balance.`);
        const agentInfo = await this.agent.getAgentInfo();
        const freeUnderlyingBalance = toBN(agentInfo.freeUnderlyingBalanceUBA);
        const minimumFreeUnderlyingBalance = toBN(this.agentBotSettings.minimumFreeUnderlyingBalance);
        logger.info(`Agent's ${this.agent.vaultAddress} free underlying balance is ${freeUnderlyingBalance}, required minimal underlying balance is minimumFreeUnderlyingBalance. Top up is required ${freeUnderlyingBalance.lt(minimumFreeUnderlyingBalance)}`.);
        if (freeUnderlyingBalance.lt(minimumFreeUnderlyingBalance)) {
            const topupAmount = minimumFreeUnderlyingBalance;
            const estimatedFee = toBN(await this.context.wallet.getTransactionFee({
                source: this.agent.underlyingAddress,
                destination: this.ownerUnderlyingAddress,
                amount: topupAmount,
                isPayment: true
            }));
            logger.info(`Agent's ${this.agent.vaultAddress} calculated estimated underlying fee is ${estimatedFee.toString()}.`);
            await this.underlyingTopUp(em, topupAmount);
        } else {
            logger.info(`Agent ${this.agent.vaultAddress} doesn't need underlying top up: freeUnderlyingBalance is ${freeUnderlyingBalance.toString()}, minimumFreeUnderlyingBalance is ${minimumFreeUnderlyingBalance.toString()}.`);
        }
    }

    /**
     * Tries to top up AgentBot's underlying account from owner's. It notifies about successful and unsuccessful try.
     * It also checks owner's underlying balance and notifies when it is too low.
     * @param amount amount to transfer from owner's underlying address to agent's underlying address
     * @param agentVault agent's vault address
     */
    async underlyingTopUp(em: EM, amount: BN): Promise<boolean> {
        // check if top up in progress
        const checkIfTopUpInProgress = await em.find(AgentUnderlyingPayment, { agentAddress: this.agent.vaultAddress, type: AgentUnderlyingPaymentType.TOP_UP, state: { $ne: AgentUnderlyingPaymentState.DONE } });
        if (checkIfTopUpInProgress.length > 0) {
            logger.info(`Agent ${this.agent.vaultAddress} will not top up. Top up already in progress.`);
            return false;
        }
        const amountF = await this.tokens.underlying.format(amount);
        logger.info(squashSpace`Agent ${this.agent.vaultAddress} is trying to top up underlying address ${this.agent.underlyingAddress}
            from owner's underlying address ${this.ownerUnderlyingAddress}.`);
        const txDbId = await this.bot.locks.underlyingLock(this.ownerUnderlyingAddress).lockAndRun(async () => {
            return await this.agent.initiateTopupPayment(amount, this.ownerUnderlyingAddress);
        });
        await this.createAgentUnderlyingPayment(em, txDbId, AgentUnderlyingPaymentType.TOP_UP);
        logger.info(squashSpace`Agent ${this.agent.vaultAddress}'s owner initiated underlying ${AgentUnderlyingPaymentType.TOP_UP} payment
            to ${this.agent.underlyingAddress} with amount ${amountF} from ${this.ownerUnderlyingAddress} with transactions database id  ${txDbId}.`);
        await this.checkForLowOwnerUnderlyingBalance();
        return true;
    }

    async checkForLowOwnerUnderlyingBalance() {
        const ownerUnderlyingBalance = await this.context.wallet.getBalance(this.ownerUnderlyingAddress);
        const expectedBalance = this.agentBotSettings.recommendedOwnerUnderlyingBalance;
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
     * @param rootEm entity manager
     * @param txHash transaction hash
     * @param type enum for underlying payment type from entity AgentUnderlyingPayment
     */
    async createAgentUnderlyingPayment(rootEm: EM, txHashOrTxDbId: string | number, type: AgentUnderlyingPaymentType): Promise<void> {
        await this.bot.runInTransaction(rootEm, async (em) => {
            rootEm.create(
                AgentUnderlyingPayment,
                {
                    agentAddress: this.agent.vaultAddress,
                    state: AgentUnderlyingPaymentState.PAID,
                    txHash: typeof txHashOrTxDbId === 'string' ? txHashOrTxDbId : null,
                    txDbId: typeof txHashOrTxDbId === 'number' ? txHashOrTxDbId : null,
                    type: type,
                } as RequiredEntityData<AgentUnderlyingPayment>,
                { persist: true }
            );
        });
        await this.notifier.sendAgentUnderlyingPaymentCreated(txHashOrTxDbId, type);
        if (typeof txHashOrTxDbId == 'string') {
            logger.info(`Agent ${this.agent.vaultAddress} send underlying ${type} payment ${txHashOrTxDbId}.`);
        } else {
            logger.info(`Agent ${this.agent.vaultAddress} initiated underlying ${type} payment with transaction database id ${txHashOrTxDbId}.`);
        }
    }

    /**
     * @param rootEm entity manager
     */
    async handleOpenUnderlyingPayments(rootEm: EM): Promise<void> {
        try {
            const openUnderlyingPayments = await this.openUnderlyingPaymentIds(rootEm);
            logger.info(`Agent ${this.agent.vaultAddress} started handling open underlying payments #${openUnderlyingPayments.length}.`);
            for (const up of openUnderlyingPayments) {
                if (this.bot.stopRequested()) return;
                await this.nextUnderlyingPaymentStep(rootEm, up.id);
            }
            logger.info(`Agent ${this.agent.vaultAddress} finished handling open underlying payments.`);
        } catch (error) {
            console.error(`Error while handling open underlying payments for agent ${this.agent.vaultAddress}: ${error}`);
            logger.error(`Agent ${this.agent.vaultAddress} run into error while handling open underlying payments:`, error);
        }
    }

    /**
     * Returns underlying payments with state other than DONE.
     * @param em entity manager
     * @return list of AgentUnderlyingPayment's instances
     */
    async openUnderlyingPaymentIds(em: EM): Promise<AgentUnderlyingPayment[]> {
        return await em.createQueryBuilder(AgentUnderlyingPayment)
            .select("id")
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
        try {
            const underlyingPayment = await rootEm.findOneOrFail(AgentUnderlyingPayment, { id: Number(id) }, { refresh: true });
            logger.info(squashSpace`Agent ${this.agent.vaultAddress} is handling open underlying ${underlyingPayment.type} payment
                ${underlyingPayment.txHash} in state ${underlyingPayment.state}.`);
            switch (underlyingPayment.state) {
                case AgentUnderlyingPaymentState.PAID:
                    await this.checkPaymentProofAvailable(rootEm, underlyingPayment);
                    break;
                case AgentUnderlyingPaymentState.REQUESTED_PROOF:
                    await this.checkConfirmPayment(rootEm, underlyingPayment);
                    break;
                default:
                    console.error(`Underlying payment state: ${underlyingPayment.state} not supported`);
                    logger.error(squashSpace`Agent ${this.agent.vaultAddress} run into underlying payment state ${underlyingPayment.state}
                        not supported for underlying ${underlyingPayment.type} payment ${underlyingPayment.txHash}.`);
            }
        } catch (error) {
            console.error(`Error handling next underlying payment step for underlying payment ${id} agent ${this.agent.vaultAddress}: ${error}`);
            logger.error(`Agent ${this.agent.vaultAddress} run into error while handling next underlying payment step for underlying payment ${id}:`, error);
        }
    }

    /**
     * When underlying payment is in state PAID it requests payment proof - see requestPaymentProof().
     * @param underlyingPayment AgentUnderlyingPayment entity
     */
    async checkPaymentProofAvailable(rootEm: EM, underlyingPayment: Readonly<AgentUnderlyingPayment>): Promise<void> {
        logger.info(`Agent ${this.agent.vaultAddress} is checking if payment proof for underlying ${underlyingPayment.type} payment ${underlyingPayment.txHash} is available.`);
        assertNotNull(underlyingPayment.txDbId);
        const info = await this.context.wallet.checkTransactionStatus(underlyingPayment.txDbId);
        if ((info.status == TransactionStatus.TX_SUCCESS || info.status == TransactionStatus.TX_FAILED)
             && info.transactionHash
        ) {
            underlyingPayment = await this.updateUnderlyingPayment(rootEm, underlyingPayment, {
                txHash: info.transactionHash
            });
            assertNotNull(underlyingPayment.txHash);
            const txBlock = await this.context.blockchainIndexer.getTransactionBlock(underlyingPayment.txHash);
            const blockHeight = await this.context.blockchainIndexer.getBlockHeight();
            if (txBlock != null && blockHeight - txBlock.number >= this.context.blockchainIndexer.finalizationBlocks) {
                await this.requestPaymentProof(rootEm, underlyingPayment);
                await this.notifier.sendAgentUnderlyingPaymentRequestPaymentProof(underlyingPayment.txHash, underlyingPayment.type);
            }
        } else if (info.status == TransactionStatus.TX_REPLACED) {
            assertNotNull(info.replacedByDdId);
            await this.updateUnderlyingPayment(rootEm, underlyingPayment, {
                txDbId: info.replacedByDdId
            });
        }
    }

    /**
     * Sends request for underlying payment payment proof, sets state for underlying payment in persistent state to REQUESTED_PROOF.
     * @param underlyingPayment AgentUnderlyingPayment entity
     */
    async requestPaymentProof(rootEm: EM, underlyingPayment: Readonly<AgentUnderlyingPayment>): Promise<void> {
        logger.info(`Agent ${this.agent.vaultAddress} is sending request for payment proof for underlying ${underlyingPayment.type} payment ${underlyingPayment.txHash}.`);
        assertNotNull(underlyingPayment.txHash);
        try {
            const sourceAddress = underlyingPayment.type == AgentUnderlyingPaymentType.TOP_UP ? null : this.agent.underlyingAddress;
            const tragetAddress = underlyingPayment.type == AgentUnderlyingPaymentType.TOP_UP ? this.agent.underlyingAddress : null;
            const request = await this.bot.locks.nativeChainLock(this.bot.requestSubmitterAddress()).lockAndRun(async () => {
                return await this.context.attestationProvider.requestPaymentProof(underlyingPayment.txHash!, sourceAddress, tragetAddress);
            });
            underlyingPayment = await this.updateUnderlyingPayment(rootEm, underlyingPayment, {
                state: AgentUnderlyingPaymentState.REQUESTED_PROOF,
                proofRequestRound: request.round,
                proofRequestData: request.data,
            });
            logger.info(squashSpace`Agent ${this.agent.vaultAddress} requested payment proof for underlying ${underlyingPayment.type}
                payment ${underlyingPayment.txHash}; proofRequestRound ${request.round}, proofRequestData ${request.data}`);
        } catch (error) {
            logger.info(`Agent ${this.agent.vaultAddress} cannot yet request payment proof for underlying ${underlyingPayment.type} payment ${underlyingPayment.txHash}:`,
                messageForExpectedError(error, [AttestationHelperError]));
        }
    }

    /**
     * When underlying payment is in state REQUESTED_PROOF, it obtains payment proof, calls confirmRedemptionPayment and sets the state of underlying payment in persistent state as DONE.
     * If proof expires, sets the state of underlying payment in persistent state as DONE and sends notification to owner.
     * If proof cannot be obtained, it sends notification to owner.
     * @param underlying payment AgentUnderlyingPayment entity
     */
    async checkConfirmPayment(rootEm: EM, underlyingPayment: Readonly<AgentUnderlyingPayment>): Promise<void> {
        logger.info(squashSpace`Agent ${this.agent.vaultAddress} is trying to obtain payment proof for underlying ${underlyingPayment.type}
            payment ${underlyingPayment.txHash} in round ${underlyingPayment.proofRequestRound} and data ${underlyingPayment.proofRequestData}.`);
        assertNotNull(underlyingPayment.proofRequestRound);
        assertNotNull(underlyingPayment.proofRequestData);
        const proof = await this.context.attestationProvider.obtainPaymentProof(underlyingPayment.proofRequestRound, underlyingPayment.proofRequestData)
            .catch(e => {
                logger.error(`Error obtaining payment proof for underlying payment:`, e);
                return null;
            });
        if (proof === AttestationNotProved.NOT_FINALIZED) {
            logger.info(squashSpace`Agent ${this.agent.vaultAddress}: proof not yet finalized for underlying ${underlyingPayment.type}
                payment ${underlyingPayment.txHash} in round ${underlyingPayment.proofRequestRound} and data ${underlyingPayment.proofRequestData}.`);
            return;
        }
        if (attestationProved(proof)) {
            logger.info(squashSpace`Agent ${this.agent.vaultAddress} obtained payment proof for underlying ${underlyingPayment.type}
                payment ${underlyingPayment.txHash} in round ${underlyingPayment.proofRequestRound} and data ${underlyingPayment.proofRequestData}.`);
            await this.bot.locks.nativeChainLock(this.bot.owner.workAddress).lockAndRun(async () => {
                if (underlyingPayment.type == AgentUnderlyingPaymentType.TOP_UP) {
                    await this.context.assetManager.confirmTopupPayment(web3DeepNormalize(proof), this.agent.vaultAddress,
                        { from: this.agent.owner.workAddress });
                } else {
                    await this.context.assetManager.confirmUnderlyingWithdrawal(web3DeepNormalize(proof), this.agent.vaultAddress,
                        { from: this.agent.owner.workAddress });
                }
            });
            underlyingPayment = await this.updateUnderlyingPayment(rootEm, underlyingPayment, {
                state: AgentUnderlyingPaymentState.DONE,
            });
            await this.notifier.sendConfirmWithdrawUnderlying(underlyingPayment.type);
            logger.info(squashSpace`Agent ${this.agent.vaultAddress} confirmed underlying ${underlyingPayment.type} payment ${underlyingPayment.txHash}
                with proof ${JSON.stringify(web3DeepNormalize(proof))}.`);
            const agentInfo = await this.agent.getAgentInfo();
            console.log(`Agent ${this.agent.vaultAddress} free underlying is ${agentInfo.freeUnderlyingBalanceUBA.toString()}`)
        } else {
            logger.info(squashSpace`Agent ${this.agent.vaultAddress} cannot obtain payment proof for underlying ${underlyingPayment.type} payment ${underlyingPayment.txHash}
                in round ${underlyingPayment.proofRequestRound} and data ${underlyingPayment.proofRequestData}.`);
            // wait for one more round and then reset to state PAID, which will eventually resubmit request
            if (await this.bot.enoughTimePassedToObtainProof(underlyingPayment)) {
                await this.notifier.sendAgentUnderlyingPaymentNoProofObtained(underlyingPayment.txHash!, underlyingPayment.type, underlyingPayment.proofRequestRound, underlyingPayment.proofRequestData);
                logger.info(`Agent ${this.agent.vaultAddress} will retry obtaining payment proof for underlying payment ${underlyingPayment.txHash}.`);
                underlyingPayment = await this.updateUnderlyingPayment(rootEm, underlyingPayment, {
                    state: AgentUnderlyingPaymentState.PAID,
                    proofRequestRound: undefined,
                    proofRequestData: undefined,
                });
            }
        }
    }

    async updateUnderlyingPayment(rootEm: EM, uid: { id: number }, modifications: Partial<AgentUnderlyingPayment>): Promise<AgentUnderlyingPayment> {
        return await this.bot.runInTransaction(rootEm, async (em) => {
            const underlyingPayment = await em.findOneOrFail(AgentUnderlyingPayment, { id: uid.id }, { refresh: true });
            Object.assign(underlyingPayment, modifications);
            return underlyingPayment;
        });
    }

}
