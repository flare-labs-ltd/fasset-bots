import { RequiredEntityData } from "@mikro-orm/core";
import BN from "bn.js";
import { EM } from "../config/orm";
import { AgentEntity, AgentUpdateSetting } from "../entities/agent";
import { AgentSettingName, AgentUpdateSettingState } from "../entities/common";
import { Agent } from "../fasset/Agent";
import { latestBlockTimestampBN } from "../utils";
import { isTransactionRevert, toBN } from "../utils/helpers";
import { logger } from "../utils/logger";
import { AgentNotifier } from "../utils/notifier/AgentNotifier";
import { AgentBot } from "./AgentBot";

export class AgentBotUpdateSettings {
    static deepCopyWithObjectCreate = true;

    constructor(
        public bot: AgentBot,
        public agent: Agent,
        public notifier: AgentNotifier,
    ) {}

    context = this.agent.context;

    /**
     * Create AgentUpdateSetting entity.
     * @param rootEm root EntityManager to manage the database context
     * @param settingName
     * @param settingValidAt
     * @param readAgentEnt
     */
    async createAgentUpdateSetting(rootEm: EM, settingName: AgentSettingName, settingValue: string, settingValidAt: BN, readAgentEnt: AgentEntity): Promise<void> {
        await this.bot.runInTransaction(rootEm, async (em) => {
            const settingAlreadyUpdating = await em.getRepository(AgentUpdateSetting)
                .findOne({ agent: readAgentEnt, name: settingName, state: AgentUpdateSettingState.WAITING });
            // set previous setting request as Done, as it will be overwritten on smart contract.
            if (settingAlreadyUpdating) {
                settingAlreadyUpdating.state = AgentUpdateSettingState.DONE;
            }
            // create new setting update
            em.create(
                AgentUpdateSetting,
                {
                    state: AgentUpdateSettingState.WAITING,
                    name: settingName,
                    value: settingValue,
                    agent: readAgentEnt,
                    validAt: toBN(settingValidAt),
                } as RequiredEntityData<AgentUpdateSetting>,
                { persist: true }
            );
            await this.notifier.sendSettingsUpdateStarted(settingName, settingValidAt.toString());
            logger.info(`Agent ${this.agent.vaultAddress} started setting ${settingName} update valid at ${settingValidAt.toString()}.`);
        });
    }

    async handleWaitForAgentSettingUpdate(rootEm: EM) {
        /* istanbul ignore next */
        if (this.bot.stopRequested()) return;
        try {
            const openUpdateSettings = await this.openUpdateSettings(rootEm);
            logger.info(`Agent ${this.agent.vaultAddress} started handling open update settings #${openUpdateSettings.length}.`);
            for (const us of openUpdateSettings) {
                /* istanbul ignore next */
                if (this.bot.stopRequested()) return;
                await this.nextUpdateSettingStep(rootEm, us);
            }
            logger.info(`Agent ${this.agent.vaultAddress} finished handling open update settings.`);
        } catch (error) {
            console.error(`Error while handling open update settings for agent ${this.agent.vaultAddress}: ${error}`);
            logger.error(`Agent ${this.agent.vaultAddress} run into error while handling open update settings:`, error);
        }

    }

    /**
     * Returns update settings with state other than DONE.
     * @param rootEm entity manager
     * @return list of AgentUpdateSetting's instances
     */
    async openUpdateSettings(rootEm: EM): Promise<AgentUpdateSetting[]> {
        return await rootEm.createQueryBuilder(AgentUpdateSetting)
            .where({ agentAddress: this.agent.vaultAddress })
            .andWhere({ $not: { state: AgentUpdateSettingState.DONE } })
            .getResultList();
    }

    /**
     * Handles update setting stored in persistent state according to their state.
     * @param rootEm entity manager
     * @param id AgentUpdateSetting's entity id
     * @param latestTimestamp
     */
    async nextUpdateSettingStep(rootEm: EM, updateSetting: Readonly<AgentUpdateSetting>): Promise<void> {
        try {
            logger.info(`Agent ${this.agent.vaultAddress} is handling open update setting ${updateSetting.name}.`);
            switch (updateSetting.state) {
                case AgentUpdateSettingState.WAITING:
                    await this.checkIfCanUpdate(rootEm, updateSetting);
                    break;
                default:
                    console.error(`Update setting state: ${updateSetting.state} not supported`);
                    logger.error(`Agent ${this.agent.vaultAddress} run into update setting state ${updateSetting.state} not supported for update setting ${updateSetting.name}.`);
            }
        } catch (error) {
            logger.error(`Error handling setting update ${updateSetting.name}:`, error);
        }
    }


    /**
     *Updates AgentUpdateSetting entity is settings was updated or if time expired
     * @param updateSetting
     * @param latestTimestamp
     */
    async checkIfCanUpdate(rootEm: EM, updateSetting: Readonly<AgentUpdateSetting>): Promise<void> {
        const updatedOrExpired = await this.updateAgentSettings(updateSetting);
        if (updatedOrExpired) {
            await this.bot.runInTransaction(rootEm, async (em) => {
                const writeUpdateSetting = await em.findOneOrFail(AgentUpdateSetting, { id: updateSetting.id }, { refresh: true });
                writeUpdateSetting.state = AgentUpdateSettingState.DONE;
            });
        }
    }

    /**
     * AgentBot tries to update setting
     * @param updateSetting
     * @param latestTimestamp
     * @returns true if settings was updated or valid time expired
     */
    async updateAgentSettings(updateSetting: Readonly<AgentUpdateSetting>): Promise<boolean> {
        logger.info(`Agent ${this.agent.vaultAddress} is waiting for ${updateSetting.name} agent setting update.`);
        // agent waiting for setting update
        const latestTimestamp = await latestBlockTimestampBN();
        if (toBN(updateSetting.validAt).lte(latestTimestamp)) {
            // agent can update setting
            try {
                await this.bot.locks.nativeChainLock(this.bot.owner.workAddress).lockAndRun(async () => {
                    await this.agent.executeAgentSettingUpdate(updateSetting.name);
                });
                await this.notifier.sendAgentSettingsUpdate(updateSetting.name);
                return true;
            } catch (error: any) {
                const isReverted = isTransactionRevert(error);
                if (isReverted) {
                    const reason = error?.message ?? "";
                    await this.notifier.sendAgentUnableToUpdateSetting(updateSetting.name, reason);
                    logger.error(`Agent ${this.agent.vaultAddress} cannot update agent setting ${updateSetting.name}=${updateSetting.value} due to error:`, error);
                    console.log(`Agent ${this.agent.vaultAddress} cannot update agent setting ${updateSetting.name}=${updateSetting.value} due to contract revert: ${reason}`);
                    return true;
                }
                logger.error(`Agent ${this.agent.vaultAddress} run into error while updating setting ${updateSetting.name}=${updateSetting.value}:`, error);
            }
        } else {
            logger.info(`Agent ${this.agent.vaultAddress} cannot update agent setting ${updateSetting.name}=${updateSetting.value}. Allowed at ${updateSetting.validAt}. Current ${latestTimestamp}.`);
        }
        return false;
    }
}
