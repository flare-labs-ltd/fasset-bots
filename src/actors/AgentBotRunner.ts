import { UseRequestContext } from "@mikro-orm/core";
import Web3 from "web3";
import { BotConfig } from "../config/BotConfig";
import { createAssetContext } from "../config/create-asset-context";
import { ORM } from "../config/orm";
import { IAssetContext } from "../fasset/IAssetContext";
import { web3 } from "../utils/web3";
import { AgentEntity } from "../entities/agent";
import { AgentBot } from "./AgentBot";

export class AgentBotRunner {
    constructor(
        public context: IAssetContext,
        public orm: ORM,
    ) { }

    async run() {
        while (true) {
            await this.runStep();
        }
    }

    @UseRequestContext()
    async runStep() {
        const em = this.orm.em;
        const agentEntities = await em.find(AgentEntity, { active: true });
        for (const agentEntity of agentEntities) {
            try {
                const agent = await AgentBot.fromEntity(this.context, agentEntity);
                await agent.handleEvents(em);
                await agent.handleOpenRedemptions(em);
            } catch (error) {
                console.error(`Error with agent ${agentEntity.vaultAddress}`, error);
            }
        }
    }
    
    static async createAndRun(orm: ORM, botConfig: BotConfig) {
        web3.setProvider(new Web3.providers.HttpProvider(botConfig.rpcUrl));
        const runners: Promise<void>[] = [];
        for (const chainConfig of botConfig.chains) {
            const assetContext = await createAssetContext(botConfig, chainConfig);
            const chainRunner = new AgentBotRunner(assetContext, orm);
            runners.push(chainRunner.run());
        }
        await Promise.all(runners);
    }
}
