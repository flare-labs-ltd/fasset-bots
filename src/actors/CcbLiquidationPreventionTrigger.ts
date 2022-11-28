import { FilterQuery } from "@mikro-orm/core";
import { MintingExecuted } from "../../typechain-truffle/AssetManager";
import { ORM } from "../config/orm";
import { AgentEntity } from "../entities/agent";
import { IAssetBotContext } from "../fasset-bots/IAssetBotContext";
import { AssetManagerEvents } from "../fasset/IAssetContext";
import { ExtractedEventArgs } from "../utils/events/common";
import { EvmEventArgs, IEvmEvents } from "../utils/events/IEvmEvents";
import { EventExecutionQueue, TriggerableEvent } from "../utils/events/ScopedEvents";
import { ScopedRunner } from "../utils/events/ScopedRunner";
import { CCB_LIQUIDATION_PREVENTION_FACTOR, toBN } from "../utils/helpers";
import { AgentBot } from "./AgentBot";

export class CcbLiquidationPreventionTrigger {
    constructor(
        public runner: ScopedRunner,
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
        // also check for liquidation after every minting
        this.assetManagerEvent('MintingExecuted').subscribe(async args => await this.handleMintingExecuted(args));
    }

    assetManagerEvent<N extends AssetManagerEvents['name']>(event: N, filter?: Partial<ExtractedEventArgs<AssetManagerEvents, N>>) {
        return this.truffleEvents.event(this.context.assetManager, event, filter);
    }

    async handleMintingExecuted(args: EvmEventArgs<MintingExecuted>) {
        const agentEntity = await this.orm.em.findOneOrFail(AgentEntity, { vaultAddress: args.agentVault } as FilterQuery<AgentEntity>);
        if (!agentEntity) return;
        const context = this.contexts.get(agentEntity.chainId);
        if (context == null) {
            console.warn(`Invalid chain id ${agentEntity.chainId}`);
            return;
        }
        const agentBot = await AgentBot.fromEntity(context, agentEntity);
        await this.checkAgentForCollateralRatio(agentBot);
        this.runner.startThread(async (scope) => {
            await this.checkAgentForCollateralRatio(agentBot)
                .catch(e => scope.exitOnExpectedError(e, []));
        })
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
