import { FilterQuery, UseRequestContext } from "@mikro-orm/core";
import { BotConfig } from "../config/BotConfig";
import { createAssetContext } from "../config/create-asset-context";
import { ORM } from "../config/orm";
import { AgentEntity } from "../entities/agent";
import { IAssetAgentBotContext } from "../fasset-bots/IAssetBotContext";
import { sleep } from "../utils/helpers";
import { requireSecret } from "../config/secrets";
import { Notifier } from "../utils/Notifier";
import { AgentBot } from "./AgentBot";
import { logger } from "../utils/logger";

export class AgentBotRunner {
    constructor(
        public contexts: Map<string, IAssetAgentBotContext>,
        public orm: ORM,
        public loopDelay: number,
        public notifier: Notifier
    ) {}

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
                const context = this.contexts.get(agentEntity.chainSymbol);
                if (context == null) {
                    console.warn(`Invalid chain symbol ${agentEntity.chainSymbol}`);
                    logger.warn(`Owner's ${requireSecret("owner.native_address")} AgentBotRunner found invalid chain symbol ${agentEntity.chainSymbol}.`);
                    continue;
                }
                const agentBot = await AgentBot.fromEntity(context, agentEntity, this.notifier);
                logger.info(`Owner's ${requireSecret("owner.native_address")} AgentBotRunner started handling agent ${agentBot.agent.vaultAddress}.`);
                await agentBot.runStep(this.orm.em);
                logger.info(`Owner's ${requireSecret("owner.native_address")} AgentBotRunner finished handling agent ${agentBot.agent.vaultAddress}.`);
            } catch (error) {
                console.error(`Error with agent ${agentEntity.vaultAddress}: ${error}`);
                logger.error(`Owner's ${requireSecret("owner.native_address")} AgentBotRunner run into error with agent ${agentEntity.vaultAddress}: ${error}`);
            }
        }
    }

    /**
     * Creates AgentBot runner from AgentBotConfig
     * @param botConfig - configs to run bot
     * @returns instance of AgentBotRunner
     */
    static async create(botConfig: BotConfig): Promise<AgentBotRunner> {
        logger.info(`Owner ${requireSecret("owner.native_address")} started to create AgentBotRunner.`);
        const contexts: Map<string, IAssetAgentBotContext> = new Map();
        for (const chainConfig of botConfig.fAssets) {
            const assetContext = await createAssetContext(botConfig, chainConfig);
            contexts.set(assetContext.chainInfo.symbol, assetContext);
            logger.info(
                `Owner's ${requireSecret("owner.native_address")} AgentBotRunner set context for chain ${assetContext.chainInfo.chainId} with symbol ${
                    chainConfig.chainInfo.symbol
                }.`
            );
        }
        logger.info(`Owner ${requireSecret("owner.native_address")} created AgentBotRunner.`);
        if (!botConfig.orm || !botConfig.notifier) {
            logger.info(`Owner ${requireSecret("owner.native_address")} cannot create AgentBotRunner. Missing notifier or orm in config.`);
            throw new Error(`Missing notifier or orm in config for owner ${requireSecret("owner.native_address")}.`);
        }
        return new AgentBotRunner(contexts, botConfig.orm, botConfig.loopDelay, botConfig.notifier);
    }
}
