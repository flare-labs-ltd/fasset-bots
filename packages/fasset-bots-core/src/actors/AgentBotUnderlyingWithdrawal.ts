import { EM } from "../config/orm";
import { AgentUnderlyingPaymentState } from "../entities/common";
import { Agent } from "../fasset/Agent";
import { confirmationAllowedAt, latestBlockTimestampBN } from "../utils";
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

    async handleUnderlyingWithdrawal(rootEm: EM) {
        /* istanbul ignore next */
        if (this.bot.stopRequested()) return;
        await this.checkCancelUnderlyingWithdrawal(rootEm);
    }

    async checkCancelUnderlyingWithdrawal(rootEm: EM) {
        try {
            const readAgentEnt = await this.bot.fetchAgentEntity(rootEm);
            if (readAgentEnt.underlyingWithdrawalWaitingForCancelation === false) {
                return;
            }
            const latestUnderlyingWithdrawal = await this.bot.underlyingManagement.getLatestOpenUnderlyingWithdrawal(rootEm, this.agent.vaultAddress);
            if (latestUnderlyingWithdrawal === null) { // this shouldn't happen, but try to cancel just in case
                await this.bot.locks.nativeChainLock(this.bot.owner.workAddress).lockAndRun(async () => {
                    await this.agent.cancelUnderlyingWithdrawal();
                });
                await this.bot.updateAgentEntity(rootEm, async (agentEnt) => {
                    agentEnt.underlyingWithdrawalWaitingForCancelation = false;
                });
                logger.warn(`Agent ${this.agent.vaultAddress} is trying to cancel underlying withdrawal, but there aren't any underlying withdrawal payments pending.`);
                return;
            }
            // cancel underlying withdrawal
            const allowedAt = confirmationAllowedAt(latestUnderlyingWithdrawal.announcedAtTimestamp, await this.agent.assetManager.getSettings());
            if (allowedAt != null && readAgentEnt.underlyingWithdrawalWaitingForCancelation) {
                logger.info(`Agent ${this.agent.vaultAddress} is waiting for canceling underlying withdrawal.`);
                const latestTimestamp = await latestBlockTimestampBN();
                if (allowedAt.lt(latestTimestamp)) {
                    // agent can confirm cancel withdrawal announcement
                    await this.bot.locks.nativeChainLock(this.bot.owner.workAddress).lockAndRun(async () => {
                        await this.agent.cancelUnderlyingWithdrawal();
                    });
                    await this.notifier.sendCancelWithdrawUnderlying();
                    logger.info(`Agent ${this.agent.vaultAddress} canceled underlying withdrawal with id ${latestUnderlyingWithdrawal.id}.`);
                    await this.bot.updateAgentEntity(rootEm, async (agentEnt) => {
                        agentEnt.underlyingWithdrawalWaitingForCancelation = false;
                    });
                    await this.bot.underlyingManagement.updateUnderlyingPayment(rootEm, latestUnderlyingWithdrawal, {
                        state: AgentUnderlyingPaymentState.DONE,
                        cancelled: true,
                    });
                } else {
                    logger.info(`Agent ${this.agent.vaultAddress} cannot yet cancel underlying withdrawal transaction with  id ${latestUnderlyingWithdrawal.id}. Allowed at ${allowedAt}. Current ${latestTimestamp}.`);
                }
            }
        } catch (error: any) {
            const agentVault = this.agent.vaultAddress;
            if (error.message?.includes("cancel too soon")) {
                logger.info(`Agent ${agentVault} cannot yet cancel underlying withdrawal. Trying again.`);
            } else if (error.message?.includes("no active announcement")) {
                await this.bot.notifier.sendNoActiveWithdrawal();
                logger.info(`Agent ${agentVault} has no active underlying withdrawal announcement.`);
                console.log(`Agent ${agentVault} has no active underlying withdrawal announcement.`);
                await this.bot.updateAgentEntity(rootEm, async (agentEnt) => {
                    agentEnt.underlyingWithdrawalWaitingForCancelation = false;
                });
            } else {
                await this.bot.updateAgentEntity(rootEm, async (agentEnt) => {
                    agentEnt.underlyingWithdrawalWaitingForCancelation = false;
                });
                console.error(`Error while handling underlying cancellation for agent ${this.agent.vaultAddress}: ${error}`);
                logger.error(`Agent ${this.agent.vaultAddress} run into error while handling underlying cancellation during handleTimelockedProcesses:`, error);
            }
        }
    }
}
