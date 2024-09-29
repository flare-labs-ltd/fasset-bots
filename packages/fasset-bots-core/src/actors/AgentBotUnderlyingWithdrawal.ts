import { EM } from "../config/orm";
import { AgentEntity } from "../entities/agent";
import { AgentUnderlyingPaymentType } from "../entities/common";
import { Agent } from "../fasset/Agent";
import { latestBlockTimestampBN } from "../utils";
import { squashSpace } from "../utils/formatting";
import { BN_ZERO, toBN } from "../utils/helpers";
import { logger } from "../utils/logger";
import { AgentNotifier } from "../utils/notifier/AgentNotifier";
import { AgentBot } from "./AgentBot";

export class AgentBotUnderlyingWithdrawal {
    static deepCopyWithObjectCreate = true;

    constructor(
        public bot: AgentBot,
        public agent: Agent,
        public notifier: AgentNotifier,
    ) {}

    context = this.agent.context;

    async confirmationAllowedAt(agentEnt: AgentEntity) {
        if (toBN(agentEnt.underlyingWithdrawalAnnouncedAtTimestamp).gt(BN_ZERO)) {
            const settings = await this.context.assetManager.getSettings();
            const announcedUnderlyingConfirmationMinSeconds = toBN(settings.announcedUnderlyingConfirmationMinSeconds);
            return toBN(agentEnt.underlyingWithdrawalAnnouncedAtTimestamp).add(announcedUnderlyingConfirmationMinSeconds);
        } else {
            return null;
        }
    }

    async handleUnderlyingWithdrawal(rootEm: EM) {
        /* istanbul ignore next */
        if (this.bot.stopRequested()) return;
        await this.checkStartWithdrawalConfirmation(rootEm);
        /* istanbul ignore next */
        if (this.bot.stopRequested()) return;
        await this.checkCancelUnderlyingWithdrawal(rootEm);
    }

    async checkStartWithdrawalConfirmation(rootEm: EM) {
        try {
            const readAgentEnt = await this.bot.fetchAgentEntity(rootEm);
            // confirm underlying withdrawal
            const confirmationAllowedAt = await this.confirmationAllowedAt(readAgentEnt);
            if (confirmationAllowedAt != null && readAgentEnt.underlyingWithdrawalConfirmTransaction != "") {
                logger.info(`Agent ${this.agent.vaultAddress} is waiting for confirming underlying withdrawal.`);
                // agent waiting for underlying withdrawal
                const latestTimestamp = await latestBlockTimestampBN();
                if (confirmationAllowedAt.lt(latestTimestamp)) {
                    // agent can confirm underlying withdrawal
                    await this.bot.underlyingManagement.createAgentUnderlyingPayment(
                        rootEm, readAgentEnt.underlyingWithdrawalConfirmTransaction, AgentUnderlyingPaymentType.WITHDRAWAL);
                    await this.bot.updateAgentEntity(rootEm, async (agentEnt) => {
                        agentEnt.underlyingWithdrawalAnnouncedAtTimestamp = BN_ZERO;
                        agentEnt.underlyingWithdrawalConfirmTransaction = "";
                    });
                } else {
                    logger.info(squashSpace`Agent ${this.agent.vaultAddress} cannot yet confirm underlying withdrawal.
                        Allowed at ${confirmationAllowedAt}. Current ${latestTimestamp}.`);
                }
            }
        } catch (error) {
            console.error(`Error while handling underlying withdrawal for agent ${this.agent.vaultAddress}: ${error}`);
            logger.error(`Agent ${this.agent.vaultAddress} run into error while handling underlying withdrawal during handleTimelockedProcesses:`, error);
        }
    }

    async checkCancelUnderlyingWithdrawal(rootEm: EM) {
        try {
            const readAgentEnt = await this.bot.fetchAgentEntity(rootEm);
            // cancel underlying withdrawal
            const confirmationAllowedAt = await this.confirmationAllowedAt(readAgentEnt);
            if (confirmationAllowedAt != null && readAgentEnt.underlyingWithdrawalWaitingForCancelation) {
                logger.info(`Agent ${this.agent.vaultAddress} is waiting for canceling underlying withdrawal.`);
                const latestTimestamp = await latestBlockTimestampBN();
                if (confirmationAllowedAt.lt(latestTimestamp)) {
                    // agent can confirm cancel withdrawal announcement
                    await this.bot.locks.nativeChainLock(this.bot.owner.workAddress).lockAndRun(async () => {
                        await this.agent.cancelUnderlyingWithdrawal();
                    });
                    await this.notifier.sendCancelWithdrawUnderlying();
                    logger.info(`Agent ${this.agent.vaultAddress} canceled underlying withdrawal transaction ${readAgentEnt.underlyingWithdrawalConfirmTransaction}.`);
                    await this.bot.updateAgentEntity(rootEm, async (agentEnt) => {
                        agentEnt.underlyingWithdrawalAnnouncedAtTimestamp = BN_ZERO;
                        agentEnt.underlyingWithdrawalConfirmTransaction = "";
                        agentEnt.underlyingWithdrawalWaitingForCancelation = false;
                    });
                } else {
                    logger.info(`Agent ${this.agent.vaultAddress} cannot yet cancel underlying withdrawal. Allowed at ${confirmationAllowedAt}. Current ${latestTimestamp}.`);
                }
            }
        } catch (error) {
            console.error(`Error while handling underlying cancelation for agent ${this.agent.vaultAddress}: ${error}`);
            logger.error(`Agent ${this.agent.vaultAddress} run into error while handling underlying cancelation during handleTimelockedProcesses:`, error);
        }
    }
}
