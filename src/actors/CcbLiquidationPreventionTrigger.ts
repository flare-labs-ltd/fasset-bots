import { FilterQuery } from "@mikro-orm/core";
import { ORM } from "../config/orm";
import { AgentEntity } from "../entities/agent";
import { IAssetBotContext } from "../fasset-bots/IAssetBotContext";
import { AssetManagerEvents } from "../fasset/IAssetContext";
import { ExtractedEventArgs } from "../utils/events/common";
import { IEvmEvents } from "../utils/events/IEvmEvents";
import { EventExecutionQueue, TriggerableEvent } from "../utils/events/ScopedEvents";
import { CCB_LIQUIDATION_PREVENTION_FACTOR, toBN } from "../utils/helpers";
import { AgentBot } from "./AgentBot";

export class CcbLiquidationPreventionTrigger {
    constructor(
        public orm: ORM,
        public context: IAssetBotContext,
        public contexts: Map<number, IAssetBotContext>,
        public eventQueue: EventExecutionQueue,
        public truffleEvents: IEvmEvents
    ) {
        this.registerForEvents();
    }

    // synthetic events
    pricesUpdated = new TriggerableEvent<void>(this.eventQueue);

    registerForEvents() {
        // check for liquidations when prices change
        this.pricesUpdated.subscribe(() => this.checkAllAgentsForColletaralRatio());
        // checking for liquidation after every minting => is done in AgentBot.ts
    }

    assetManagerEvent<N extends AssetManagerEvents['name']>(event: N, filter?: Partial<ExtractedEventArgs<AssetManagerEvents, N>>) {
        return this.truffleEvents.event(this.context.assetManager, event, filter);
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
