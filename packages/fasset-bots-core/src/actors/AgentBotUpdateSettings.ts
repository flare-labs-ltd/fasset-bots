import { FilterQuery, RequiredEntityData } from "@mikro-orm/core";
import BN from "bn.js";
import { EM } from "../config/orm";
import { AgentEntity, AgentUpdateSetting } from "../entities/agent";
import { AgentUpdateSettingState } from "../entities/common";
import { Agent } from "../fasset/Agent";
import { errorIncluded, toBN } from "../utils/helpers";
import { logger } from "../utils/logger";
import { AgentNotifier } from "../utils/notifier/AgentNotifier";

export class AgentBotUpdateSettings {
    static deepCopyWithObjectCreate = true;

    constructor(
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
    async createAgentUpdateSetting(rootEm: EM, settingName: string, settingValidAt: BN, readAgentEnt: AgentEntity): Promise<void> {
        const settingAlreadyUpdating = await rootEm.getRepository(AgentUpdateSetting)
            .findOne({ name: settingName, state: AgentUpdateSettingState.WAITING } as FilterQuery<AgentUpdateSetting>);
        // Set previous setting request as Done, as it will be overwritten on smart contract.
        if(settingAlreadyUpdating) {
            settingAlreadyUpdating.state = AgentUpdateSettingState.DONE;
            await rootEm.flush();
        }

        rootEm.create(
            AgentUpdateSetting,
            {
                state: AgentUpdateSettingState.WAITING,
                name: settingName,
                agent: readAgentEnt,
                validAt: toBN(settingValidAt),
            } as RequiredEntityData<AgentUpdateSetting>,
            { persist: true }
        );
        await rootEm.flush();
        await this.notifier.sendSettingsUpdateStarted(settingName, settingValidAt.toString());
        logger.info(`Agent ${this.agent.vaultAddress} started setting ${settingName} update valid at ${settingValidAt.toString()}.`);
    }

    /**
     * Returns update settings with state other than DONE.
     * @param em entity manager
     * @return list of AgentUpdateSetting's instances
     */
    async openUpdateSettingIds(em: EM): Promise<AgentUpdateSetting[]> {
        const query = em.createQueryBuilder(AgentUpdateSetting).select("id");
        return await query
            .where({ agentAddress: this.agent.vaultAddress })
            .andWhere({ $not: { state: AgentUpdateSettingState.DONE } })
            .getResultList();
    }

    /**
     * Handles update setting  stored in persistent state according to their state.
     * @param rootEm entity manager
     * @param id AgentUpdateSetting's entity id
     * @param latestTimestamp
     */
    async nextUpdateSettingStep(rootEm: EM, id: number, latestTimestamp: BN): Promise<void> {
        await rootEm
            .transactional(async (em) => {
                const updateSetting = await em
                    .getRepository(AgentUpdateSetting)
                    .findOneOrFail({ id: Number(id) } as FilterQuery<AgentUpdateSetting>);
                logger.info(`Agent ${this.agent.vaultAddress} is handling open update setting ${updateSetting.name}.`);
                switch (updateSetting.state) {
                    case AgentUpdateSettingState.WAITING:
                        await this.checkIfCanUpdate(updateSetting, latestTimestamp);
                        break;
                    default:
                        console.error(`Update setting state: ${updateSetting.state} not supported`);
                        logger.error(
                            `Agent ${this.agent.vaultAddress} run into update setting state ${updateSetting.state} not supported for update setting ${updateSetting.name}.`
                        );
                }
            })
            .catch((error) => {
                console.error(`Error handling next update setting  step for update setting ${id} agent ${this.agent.vaultAddress}: ${error}`);
                logger.error(`Agent ${this.agent.vaultAddress} run into error while handling next update setting  step for update setting  ${id}:`, error);
            });
    }


    /**
     *Updates AgentUpdateSetting entity is settings was updated or if time expired
     * @param updateSetting
     * @param latestTimestamp
     */
    async checkIfCanUpdate(updateSetting: AgentUpdateSetting, latestTimestamp: BN): Promise<void> {
        const updatedOrExpired = await this.updateAgentSettings(updateSetting, latestTimestamp);
        if (updatedOrExpired) {
            updateSetting.state = AgentUpdateSettingState.DONE;
        }

    }

    /**
     * AgentBot tries to update setting
     * @param updateSetting
     * @param latestTimestamp
     * @returns true if settings was updated or valid time expired
     */
    async updateAgentSettings(updateSetting: AgentUpdateSetting, latestTimestamp: BN): Promise<boolean> {
        logger.info(`Agent ${this.agent.vaultAddress} is waiting for ${updateSetting.name} agent setting update.`);
        // agent waiting for setting update
        if (toBN(updateSetting.validAt).lte(latestTimestamp)) {
            // agent can update setting
            try {
                await this.agent.executeAgentSettingUpdate(updateSetting.name);
                await this.notifier.sendAgentSettingsUpdate(updateSetting.name);
                return true;
            } catch (error) {
                if (errorIncluded(error, ["update not valid anymore", "no pending update"])) {
                    await this.notifier.sendAgentCannotUpdateSettingExpired(updateSetting.name);
                    return true;
                }
                logger.error(`Agent ${this.agent.vaultAddress} run into error while updating setting ${updateSetting.name}:`, error);
            }
        } else {
            logger.info(`Agent ${this.agent.vaultAddress} cannot update agent setting ${updateSetting.name}. Allowed at ${updateSetting.validAt}. Current ${latestTimestamp}.`);
        }
        return false;
    }
}
