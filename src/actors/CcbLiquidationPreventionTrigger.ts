import { FilterQuery } from "@mikro-orm/core";
import { ORM } from "../config/orm";
import { AgentEntity } from "../entities/agent";
import { IAssetBotContext } from "../fasset-bots/IAssetBotContext";
import { Prices } from "../state/Prices";
import { IEvmEvents } from "../utils/events/IEvmEvents";
import { EventExecutionQueue, TriggerableEvent } from "../utils/events/ScopedEvents";
import { CCB_LIQUIDATION_PREVENTION_FACTOR, toBN } from "../utils/helpers";
import { ILogger } from "../utils/logging";
import { AgentBot } from "./AgentBot";

export class CcbLiquidationPreventionTrigger {
    constructor(
        public orm: ORM,
        public context: IAssetBotContext,
        public contexts: Map<number, IAssetBotContext>,
        public eventQueue: EventExecutionQueue,
        public truffleEvents: IEvmEvents
    ) {}

    // must call initialize to init prices and settings
    prices!: Prices;
    trustedPrices!: Prices;

    // settings
    logger?: ILogger;

    async getPrices(settings: any): Promise<[Prices, Prices]> {
        return await Prices.getPrices(this.context, settings);
    }

    // synthetic events
    pricesUpdated = new TriggerableEvent<void>(this.eventQueue);

    // async initialization part
    async initialize() {
        const settings = await this.context.assetManager.getSettings();
        [this.prices, this.trustedPrices] = await this.getPrices(settings);
        // track price changes
        this.truffleEvents.event(this.context.ftsoManager, 'PriceEpochFinalized').subscribe(async args => {
            const [prices, trustedPrices] = await this.getPrices(settings);
            this.logger?.log(`PRICES CHANGED  ftso=${this.prices}->${prices}  trusted=${this.trustedPrices}->${trustedPrices}`);
            [this.prices, this.trustedPrices] = [prices, trustedPrices];
            // trigger event
            this.pricesUpdated.trigger();
        });
        this.registerForEvents();
    }

    registerForEvents() {
        // check for collateral ratio when prices change
        this.pricesUpdated.subscribe(() => this.checkAllAgentsForColletaralRatio());
        // checking for collateral ratio after every minting => is done in AgentBot.ts
    }

    async checkAllAgentsForColletaralRatio() {
        const agentEntities = await this.orm.em.find(AgentEntity, { active: true } as FilterQuery<AgentEntity>);
        for (const agentEntity of agentEntities) {
            try {
                const context = this.contexts.get(agentEntity.chainId);
                if (context == null) {
                    console.warn(`Invalid chain id ${agentEntity.chainId}`);
                    continue;
                }
                const agentBot = await AgentBot.fromEntity(context, agentEntity);
                await this.checkAgentForCollateralRatio(agentBot);
            } catch (error) {
                console.error(`Error with agent ${agentEntity.vaultAddress}`, error);
            }
        }
    }

    private async checkAgentForCollateralRatio(agentBot: AgentBot) {
        const agentInfo = await agentBot.agent.getAgentInfo();
        const cr = agentInfo.collateralRatioBIPS;
        const settings = await agentBot.agent.context.assetManager.getSettings();
        const minCollateralRatioBIPS = toBN(settings.minCollateralRatioBIPS);
        if (cr <= minCollateralRatioBIPS.muln(CCB_LIQUIDATION_PREVENTION_FACTOR)) {
            await agentBot.topupCollateral('trigger');
        }
    }
}
