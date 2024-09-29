import { ORM } from "../config/orm";
import { AgentEntity } from "../entities/agent";
import { artifacts } from "../utils/web3";
import { logger } from "../utils/logger";

const IIAgentVault = artifacts.require("IIAgentVault");

export class AgentBotDbUpgrades {
    static deepCopyWithObjectCreate = true;

    static async performUpgrades(orm: ORM) {
        await this.fillAssetManagerFields(orm);
    }
    /* istanbul ignore next */
    static async fillAssetManagerFields(orm: ORM) {
        const agentEntities = await orm.em.find(AgentEntity, { assetManager: null });
        for (const agentEnt of agentEntities) {
            const agent = await IIAgentVault.at(agentEnt.vaultAddress);
            if (agentEnt.assetManager == null) {
                agentEnt.assetManager = await agent.assetManager();
                console.log(`Autofill asset manager in database for agent ${agentEnt.vaultAddress} to asset manager ${agentEnt.assetManager}`);
                logger.info(`Autofill asset manager in database for agent ${agentEnt.vaultAddress} to asset manager ${agentEnt.assetManager}`);
                await orm.em.flush();
            }
        }
    }
}
