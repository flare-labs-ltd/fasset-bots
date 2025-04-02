import { RequiredEntityData } from "@mikro-orm/core";
import BN from "bn.js";
import { AgentBotSettings } from "../config";
import { EM } from "../config/orm";
import { AgentUnderlyingPayment } from "../entities/agent";
import { AgentUnderlyingPaymentState, AgentUnderlyingPaymentType } from "../entities/common";
import { Agent } from "../fasset/Agent";
import { AttestationHelperError, attestationProved } from "../underlying-chain/AttestationHelper";
import { AttestationNotProved } from "../underlying-chain/interfaces/IFlareDataConnectorClient";
import { squashSpace } from "../utils/formatting";
import { assertNotNull, BN_ZERO, errorIncluded, messageForExpectedError, requireNotNull, toBN } from "../utils/helpers";
import { logger } from "../utils/logger";
import { AgentNotifier } from "../utils/notifier/AgentNotifier";
import { web3DeepNormalize } from "../utils/web3normalize";
import { AgentBot } from "./AgentBot";
import { AgentTokenBalances } from "./AgentTokenBalances";
import { TransactionStatus } from "@flarelabs/simple-wallet";
import { Payment } from "@flarenetwork/state-connector-protocol/dist/generated/types/typescript/Payment";
import { confirmationAllowedAt } from "../utils/fasset-helpers";
import { latestBlockTimestampBN } from "../utils/web3helpers";

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
        const topUpNeeded = freeUnderlyingBalance.lt(minimumFreeUnderlyingBalance);
        logger.info(`Agent's ${this.agent.vaultAddress} free underlying balance is ${freeUnderlyingBalance}, required minimal underlying balance is ${minimumFreeUnderlyingBalance}. Top up is required ${topUpNeeded}.`);
        if (topUpNeeded) {
            // check for a top up in progress
            const checkIfTopUpInProgress = await em.find(AgentUnderlyingPayment, {
                agentAddress: this.agent.vaultAddress,
                type: AgentUnderlyingPaymentType.TOP_UP,
                state: { $ne: AgentUnderlyingPaymentState.DONE }
            });
            if (checkIfTopUpInProgress.length === 0) {
                await this.underlyingTopUp(em, minimumFreeUnderlyingBalance);
            } else {
                logger.info(`Agent ${this.agent.vaultAddress} will not top up automatically. Top up already in progress.`);
            }
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
        const amountF = await this.tokens.underlying.format(amount);
        await this.notifier.sendStartUnderlyingTopup(amountF);
        logger.info(squashSpace`Agent ${this.agent.vaultAddress} is trying to top up underlying address ${this.agent.underlyingAddress}
            from owner's underlying address ${this.ownerUnderlyingAddress}.`);
        const canTopUp = await this.checkForLowOwnerUnderlyingBalance();
        if (!canTopUp) {
            logger.warn(squashSpace`Agent's ${this.agent.vaultAddress} CANNOT be topped up! Check owner's underlying balance ${this.ownerUnderlyingAddress}.`);
            console.warn(squashSpace`Agent's ${this.agent.vaultAddress} CANNOT be topped up! Check owner's underlying balance ${this.ownerUnderlyingAddress}.`);
            return false;
        }
        // check and log the fee
        const estimatedFee = toBN(await this.context.wallet.getTransactionFee({
            source: this.ownerUnderlyingAddress,
            destination: this.agent.underlyingAddress,
            amount: amount,
            isPayment: true
        }));
        logger.info(`Agent's ${this.agent.vaultAddress} calculated estimated underlying fee is ${estimatedFee.toString()}.`);
        // start payment
        const txDbId = await this.bot.locks.underlyingLock(this.ownerUnderlyingAddress).lockAndRun(async () => {
            return await this.agent.initiateTopupPayment(amount, this.ownerUnderlyingAddress);
        });
        await this.createAgentUnderlyingPayment(em, txDbId, AgentUnderlyingPaymentType.TOP_UP, AgentUnderlyingPaymentState.PAID);
        await this.notifier.sendUnderlyingTopupPaymentCreated(amountF);
        logger.info(squashSpace`Agent ${this.agent.vaultAddress}'s owner initiated underlying ${AgentUnderlyingPaymentType.TOP_UP} payment
            to ${this.agent.underlyingAddress} with amount ${amountF} from ${this.ownerUnderlyingAddress} with transactions database id  ${txDbId}.`);
        await this.checkForLowOwnerUnderlyingBalance();
        return true;
    }

    /**
     * Tries to top up AgentBot's underlying account from owner's. It notifies about successful and unsuccessful try.
     * It also checks owner's underlying balance and notifies when it is too low.
     * @param amount amount to transfer from owner's underlying address to agent's underlying address
     * @param agentVault agent's vault address
     */
    async startSelfMinting(em: EM, lots: BN): Promise<boolean> {
        const amount = await this.agent.getSelfMintPaymentAmount(lots);
        const amountF = await this.tokens.underlying.format(amount);
        logger.info(squashSpace`Agent ${this.agent.vaultAddress} is trying to pay for self-minting to underlying address ${this.agent.underlyingAddress}
            from owner's underlying address ${this.ownerUnderlyingAddress}.`);
        const hasEnoughBalance = await this.checkForLowOwnerUnderlyingBalance();
        if (!hasEnoughBalance) {
            logger.warn(squashSpace`Agent's ${this.agent.vaultAddress} CANNOT do self minting! Check owner's underlying balance ${this.ownerUnderlyingAddress}.`);
            console.warn(squashSpace`Agent's ${this.agent.vaultAddress} CANNOT do self minting! Check owner's underlying balance ${this.ownerUnderlyingAddress}.`);
            return false;
        }
        // check and log the fee
        const estimatedFee = toBN(await this.context.wallet.getTransactionFee({
            source: this.ownerUnderlyingAddress,
            destination: this.agent.underlyingAddress,
            amount: amount,
            isPayment: true
        }));
        logger.info(`Agent's ${this.agent.vaultAddress} calculated estimated underlying fee is ${estimatedFee.toString()}.`);
        // start payment
        const txDbId = await this.bot.locks.underlyingLock(this.ownerUnderlyingAddress).lockAndRun(async () => {
            return await this.agent.initiateSelfMintPayment(amount, this.ownerUnderlyingAddress);
        });
        await this.createAgentUnderlyingPayment(em, txDbId, AgentUnderlyingPaymentType.SELF_MINT, AgentUnderlyingPaymentState.PAID, undefined, undefined, lots);
        logger.info(squashSpace`Agent ${this.agent.vaultAddress}'s owner initiated underlying ${AgentUnderlyingPaymentType.SELF_MINT} payment
            to ${this.agent.underlyingAddress} with amount ${amountF} from ${this.ownerUnderlyingAddress} with transactions database id  ${txDbId}.`);
        await this.checkForLowOwnerUnderlyingBalance();
        return true;
    }

    async checkForLowOwnerUnderlyingBalance(): Promise<boolean> {
        const ownerUnderlyingBalance = await this.context.wallet.getBalance(this.ownerUnderlyingAddress);
        const expectedBalance = this.agentBotSettings.recommendedOwnerUnderlyingBalance;
        const balanceF = await this.tokens.underlying.format(ownerUnderlyingBalance);
        const expectedBalanceF = await this.tokens.underlying.format(expectedBalance);
        if (ownerUnderlyingBalance.lte(expectedBalance)) {
            await this.notifier.sendLowBalanceOnUnderlyingOwnersAddress(this.ownerUnderlyingAddress, balanceF);
            logger.info(squashSpace`Agent's ${this.agent.vaultAddress} owner ${this.agent.owner.managementAddress} has low balance
                ${balanceF} on underlying address ${this.ownerUnderlyingAddress}. Expected to have at least ${expectedBalanceF}.`);
            return false;
        } else {
            logger.info(squashSpace`Agent's ${this.agent.vaultAddress} owner ${this.agent.owner.managementAddress} has ${balanceF}
                on underlying address ${this.ownerUnderlyingAddress}.`);
            return true;
        }
    }

    /**
     * Stores sent underlying payment.
     * @param rootEm entity manager
     * @param txHash transaction hash
     * @param type enum for underlying payment type from entity AgentUnderlyingPayment
     */
    async createAgentUnderlyingPayment(rootEm: EM, txDbId: number, type: AgentUnderlyingPaymentType, paymentState: AgentUnderlyingPaymentState, txHash?: string, announcedAt?: BN, selfMintLots?: BN): Promise<void> {
        await this.bot.runInTransaction(rootEm, async (em) => {
            em.create(
                AgentUnderlyingPayment,
                {
                    agentAddress: this.agent.vaultAddress,
                    state: paymentState,
                    txHash: txHash ?? null,
                    txDbId: txDbId,
                    type: type,
                    announcedAtTimestamp: announcedAt ?? BN_ZERO,
                    selfMintLots: selfMintLots,
                } as RequiredEntityData<AgentUnderlyingPayment>,
                { persist: true }
            );
        });
        await this.notifier.sendAgentUnderlyingPaymentCreated(txDbId, type, txHash);
        if (txHash) {
            logger.info(`Agent ${this.agent.vaultAddress} send underlying ${type} payment ${txDbId} (${txHash}).`);
        } else {
            logger.info(`Agent ${this.agent.vaultAddress} initiated underlying ${type} payment with transaction database id ${txDbId}.`);
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
                /* istanbul ignore next */
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
            logger.info(squashSpace`Agent ${this.agent.vaultAddress} is handling open underlying ${underlyingPayment.type} payment id ${id} and hash
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
            if (errorIncluded(error, ["no active announcement"])) {
                const underlyingPayment = await rootEm.findOneOrFail(AgentUnderlyingPayment, {id }, { refresh: true });
                await this.updateUnderlyingPayment(rootEm, underlyingPayment, {
                    state: AgentUnderlyingPaymentState.DONE,
                });
                logger.warn(`Agent ${this.agent.vaultAddress} closed underlying payment ${id} because it was already confirmed`);
                console.log(`Agent ${this.agent.vaultAddress} closed underlying payment ${id} because it was already confirmed`);
            } else {
                console.error(`Error handling next underlying payment step for underlying payment ${id} agent ${this.agent.vaultAddress}: ${error}`);
            logger.error(`Agent ${this.agent.vaultAddress} run into error while handling next underlying payment step for underlying payment ${id}:`, error);
            }
        }
    }

    /**
     * When underlying payment is in state PAID it requests payment proof - see requestPaymentProof().
     * @param underlyingPayment AgentUnderlyingPayment entity
     */
    async checkPaymentProofAvailable(rootEm: EM, underlyingPayment: Readonly<AgentUnderlyingPayment>): Promise<void> {
        logger.info(`Agent ${this.agent.vaultAddress} is checking if payment proof for underlying ${underlyingPayment.type} payment database id ${underlyingPayment.txDbId} is available.`);
        assertNotNull(underlyingPayment.txDbId);
        const info = await this.context.wallet.checkTransactionStatus(underlyingPayment.txDbId);
        if (info.status == TransactionStatus.TX_SUCCESS || info.status == TransactionStatus.TX_FAILED) {
            if (info.transactionHash) {
                underlyingPayment = await this.updateUnderlyingPayment(rootEm, underlyingPayment, {
                    txHash: info.transactionHash
                });
                assertNotNull(underlyingPayment.txHash);
                if (await this.bot.underlyingTransactionFinalized(underlyingPayment.txHash)) {
                    await this.requestPaymentProof(rootEm, underlyingPayment);
                    await this.notifier.sendAgentUnderlyingPaymentRequestPaymentProof(underlyingPayment.txHash, underlyingPayment.type);
                }
            } else {
                if (underlyingPayment.type === AgentUnderlyingPaymentType.WITHDRAWAL) {
                    await this.bot.updateAgentEntity(rootEm, async (agentEnt) => {
                        agentEnt.underlyingWithdrawalWaitingForCancelation = true;
                    });
                } else if (underlyingPayment.type === AgentUnderlyingPaymentType.TOP_UP || underlyingPayment.type === AgentUnderlyingPaymentType.SELF_MINT) {
                    await this.cancelTopUpPayment(rootEm, underlyingPayment);
                }
            }
        } else if (info.status == TransactionStatus.TX_REPLACED && (
            info.replacedByStatus == TransactionStatus.TX_SUCCESS || info.replacedByStatus == TransactionStatus.TX_FAILED
        )) {
            if (info.replacedByHash) {
                underlyingPayment = await this.updateUnderlyingPayment(rootEm, underlyingPayment, {
                    txHash: info.replacedByHash
                });
                assertNotNull(underlyingPayment.txHash);
                if (await this.bot.underlyingTransactionFinalized(underlyingPayment.txHash)) {
                    await this.requestPaymentProof(rootEm, underlyingPayment);
                    await this.notifier.sendAgentUnderlyingPaymentRequestPaymentProof(underlyingPayment.txHash, underlyingPayment.type);
                }
            } else {
                if (underlyingPayment.type === AgentUnderlyingPaymentType.WITHDRAWAL) {
                    if (underlyingPayment.type === AgentUnderlyingPaymentType.WITHDRAWAL) {
                        await this.bot.updateAgentEntity(rootEm, async (agentEnt) => {
                            agentEnt.underlyingWithdrawalWaitingForCancelation = true;
                        });
                    }
                } else if (underlyingPayment.type === AgentUnderlyingPaymentType.TOP_UP || underlyingPayment.type === AgentUnderlyingPaymentType.SELF_MINT) {
                    await this.cancelTopUpPayment(rootEm, underlyingPayment);
                }
            }
        }
    }

    /**
     * Sends request for underlying payment payment proof, sets state for underlying payment in persistent state to REQUESTED_PROOF.
     * @param underlyingPayment AgentUnderlyingPayment entity
     */
    async requestPaymentProof(rootEm: EM, underlyingPayment: Readonly<AgentUnderlyingPayment>): Promise<void> {
        logger.info(`Agent ${this.agent.vaultAddress} is sending request for payment proof for underlying ${underlyingPayment.type} payment ${underlyingPayment.txHash}.`);
        try {
            const paymentToVaultUnderlyingAddress = underlyingPayment.type == AgentUnderlyingPaymentType.TOP_UP || underlyingPayment.type == AgentUnderlyingPaymentType.SELF_MINT;
            const sourceAddress = paymentToVaultUnderlyingAddress ? null : this.agent.underlyingAddress;
            const tragetAddress = paymentToVaultUnderlyingAddress ? this.agent.underlyingAddress : null;
            const request = await this.bot.locks.nativeChainLock(this.bot.requestSubmitterAddress()).lockAndRun(async () => {
                assertNotNull(underlyingPayment.txHash);
                return await this.context.attestationProvider.requestPaymentProof(underlyingPayment.txHash, sourceAddress, tragetAddress);
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
                    await this.sendUnderlyingPaymentConfirmed(rootEm, underlyingPayment, proof);
                } if (underlyingPayment.type == AgentUnderlyingPaymentType.SELF_MINT) {
                    await this.bot.minting.executeSelfMinting(proof, requireNotNull(underlyingPayment.selfMintLots));
                    await this.sendUnderlyingPaymentConfirmed(rootEm, underlyingPayment, proof);
                } else {
                    const allowedAt = confirmationAllowedAt(underlyingPayment.announcedAtTimestamp, await this.bot.agent.assetManager.getSettings())
                    const latestTimestamp = await latestBlockTimestampBN();
                    if (allowedAt && allowedAt.lt(latestTimestamp)) {
                        await this.context.assetManager.confirmUnderlyingWithdrawal(web3DeepNormalize(proof), this.agent.vaultAddress,
                        { from: this.agent.owner.workAddress });
                        await this.sendUnderlyingPaymentConfirmed(rootEm, underlyingPayment, proof);
                    } else {
                        logger.info(`Agent ${this.agent.vaultAddress} cannot yet confirm ${underlyingPayment.type} payment ${underlyingPayment.txHash} with id ${underlyingPayment.id}`)
                    }
                }
            });
        } else {
            logger.info(squashSpace`Agent ${this.agent.vaultAddress} cannot obtain payment proof for underlying ${underlyingPayment.type} payment ${underlyingPayment.txHash}
                in round ${underlyingPayment.proofRequestRound} and data ${underlyingPayment.proofRequestData}.`);
            // wait for one more round and then reset to state PAID, which will eventually resubmit request
            if (await this.bot.enoughTimePassedToObtainProof(underlyingPayment)) {
                assertNotNull(underlyingPayment.txHash);
                await this.notifier.sendAgentUnderlyingPaymentNoProofObtained(underlyingPayment.txHash, underlyingPayment.type, underlyingPayment.proofRequestRound, underlyingPayment.proofRequestData);
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

    async sendUnderlyingPaymentConfirmed(rootEm: EM, underlyingPayment:  Readonly<AgentUnderlyingPayment>, proof: Payment.Proof): Promise<void> {
        underlyingPayment = await this.updateUnderlyingPayment(rootEm, underlyingPayment, {
            state: AgentUnderlyingPaymentState.DONE,
        });
        await this.notifier.sendConfirmWithdrawUnderlying(underlyingPayment.type);
        logger.info(squashSpace`Agent ${this.agent.vaultAddress} confirmed underlying ${underlyingPayment.type} payment ${underlyingPayment.txHash}
            with proof ${JSON.stringify(web3DeepNormalize(proof))}.`);
        const agentInfo = await this.agent.getAgentInfo();
        console.log(`Agent ${this.agent.vaultAddress} free underlying is ${agentInfo.freeUnderlyingBalanceUBA.toString()}`)
    }

    async getLatestOpenUnderlyingWithdrawal(rootEm: EM, vaultAddress: string): Promise<AgentUnderlyingPayment | null>{
        const latestUnderlyingWithdrawal = await rootEm.findOne(AgentUnderlyingPayment,
            {
              state: { $ne: AgentUnderlyingPaymentState.DONE },
              type: AgentUnderlyingPaymentType.WITHDRAWAL,
              agentAddress: vaultAddress
            },
            { orderBy: { createdAt: 'DESC' } }
          );

        return latestUnderlyingWithdrawal;
    }

    async cancelTopUpPayment(rootEm: EM, underlyingPayment: AgentUnderlyingPayment): Promise<void>{
        await this.updateUnderlyingPayment(rootEm, underlyingPayment, {
            state: AgentUnderlyingPaymentState.DONE,
            cancelled: true
        });
        logger.warn(`Agent ${this.agent.vaultAddress} cancelled top up underlying payment ${underlyingPayment.id}.`);
        await this.notifier.sendUnderlyingTopUpFailedAlert(underlyingPayment.id);
    }
}
