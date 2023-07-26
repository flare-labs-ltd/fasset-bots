import { FilterQuery, UseRequestContext } from "@mikro-orm/core";
import { BotConfig } from "../config/BotConfig";
import { createAssetContext } from "../config/create-asset-context";
import { ORM } from "../config/orm";
import { AgentEntity } from "../entities/agent";
import { IAssetAgentBotContext } from "../fasset-bots/IAssetBotContext";
import { sleep } from "../utils/helpers";
import { Notifier } from "../utils/Notifier";
import { AgentBot } from "./AgentBot";

export class AgentBotRunner {
    constructor(
        public contexts: Map<number, IAssetAgentBotContext>,
        public orm: ORM,
        public loopDelay: number,
        public notifier: Notifier
    ) { }

    private stopRequested = false;

    async run(): Promise<void> {
        this.stopRequested = false;
        while (!this.stopRequested) {
            await this.runStep();
            await sleep(this.loopDelay);
        }
    }

    requestStop(): void {
        this.stopRequested = true;
    }

    /**
     * This is the main method, where "automatic" logic is gathered.
     * In every step it firstly collects all active agent entities. For every entity it construct AgentBot and runs its runsStep method,
     * which handles required events and other.
     */
    @UseRequestContext()
    async runStep(): Promise<void> {
        const agentEntities = await this.orm.em.find(AgentEntity, { active: true } as FilterQuery<AgentEntity>);
        for (const agentEntity of agentEntities) {
            try {
                const context = this.contexts.get(agentEntity.chainId);
                if (context == null) {
                    console.warn(`Invalid chain id ${agentEntity.chainId}`);
                    continue;
                }
                const agentBot = await AgentBot.fromEntity(context, agentEntity, this.notifier);
                await agentBot.runStep(this.orm.em);
            } catch (error) {
                console.error(`Error with agent ${agentEntity.vaultAddress}: ${error}`);
            }
        }
    }

    /**
     * Creates AgentBot runner from AgentBotConfig
     * @param botConfig - configs to run bot
     */
    static async create(botConfig: BotConfig): Promise<AgentBotRunner> {
        const contexts: Map<number, IAssetAgentBotContext> = new Map();
        for (const chainConfig of botConfig.chains) {
            const assetContext = await createAssetContext(botConfig, chainConfig);
            contexts.set(assetContext.chainInfo.chainId, assetContext);
        }
        return new AgentBotRunner(contexts, botConfig.orm, botConfig.loopDelay, botConfig.notifier);
    }
}
