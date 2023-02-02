import { FilterQuery, UseRequestContext } from "@mikro-orm/core";
import { BotConfig } from "../config/BotConfig";
import { createAssetContext } from "../config/create-asset-context";
import { ORM } from "../config/orm";
import { AgentEntity } from "../entities/agent";
import { IAssetBotContext } from "../fasset-bots/IAssetBotContext";
import { sleep } from "../utils/helpers";
import { AgentBot } from "./AgentBot";

export class AgentBotRunner {
    constructor(
        public contexts: Map<number, IAssetBotContext>,
        public orm: ORM,
        public loopDelay: number
    ) { }

    private stopRequested = false;

    async run() {
        this.stopRequested = false;
        while (!this.stopRequested) {
            await this.runStep();
            await sleep(this.loopDelay);
        }
    }

    requestStop() {
        this.stopRequested = true;
    }

    @UseRequestContext()
    async runStep() {
        const agentEntities = await this.orm.em.find(AgentEntity, { active: true } as FilterQuery<AgentEntity>);
        for (const agentEntity of agentEntities) {
            try {
                const context = this.contexts.get(agentEntity.chainId);
                if (context == null) {
                    console.warn(`Invalid chain id ${agentEntity.chainId}`);
                    continue;
                }
                const agentBot = await AgentBot.fromEntity(context, agentEntity);
                await agentBot.runStep(this.orm.em);
            } catch (error) {
                console.error(`Error with agent ${agentEntity.vaultAddress}`, error);
            }
        }
    }

    @UseRequestContext()
    async createMissingAgents(ownerAddress: string) {
        for (const [chainId, context] of this.contexts) {
            const existing = await this.orm.em.count(AgentEntity, { chainId, active: true } as FilterQuery<AgentEntity>);
            if (existing === 0) {
                await AgentBot.create(this.orm.em, context, ownerAddress);
            }
        }
    }

    static async create(botConfig: BotConfig) {
        const contexts: Map<number, IAssetBotContext> = new Map();
        for (const chainConfig of botConfig.chains) {
            const assetContext = await createAssetContext(botConfig, chainConfig);
            contexts.set(assetContext.chainInfo.chainId, assetContext);
        }
        return new AgentBotRunner(contexts, botConfig.orm, botConfig.loopDelay);
    }
}
