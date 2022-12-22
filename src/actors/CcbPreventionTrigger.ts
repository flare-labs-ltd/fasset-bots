import { FilterQuery } from "@mikro-orm/core";
import { EM, ORM } from "../config/orm";
import { AgentEntity } from "../entities/agent";
import { ActorEntity, ActorType } from "../entities/actor";
import { IAssetBotContext } from "../fasset-bots/IAssetBotContext";
import { EvmEvent } from "../utils/events/common";
import { eventIs } from "../utils/events/truffle";
import { CCB_LIQUIDATION_PREVENTION_FACTOR, systemTimestamp, toBN } from "../utils/helpers";
import { AgentBot } from "./AgentBot";
import { web3 } from "../utils/web3";
import { Web3EventDecoder } from "../utils/events/Web3EventDecoder";

export class CcbPreventionTrigger {
    constructor(
        public context: IAssetBotContext,
        public contexts: Map<number, IAssetBotContext>,
        public address: string
    ) {}

    eventDecoder = new Web3EventDecoder({ ftsoManager: this.context.ftsoManager });
    
    static async create(rootEm: EM, context: IAssetBotContext, contexts: Map<number, IAssetBotContext>, address: string) {
        const lastBlock = await web3.eth.getBlockNumber();
        return await rootEm.transactional(async em => {
            const ccbTriggerEntity = new ActorEntity();
            ccbTriggerEntity.chainId = context.chainInfo.chainId;
            ccbTriggerEntity.address = address;
            ccbTriggerEntity.lastEventBlockHandled = lastBlock;
            ccbTriggerEntity.type = ActorType.CCB_PREVENTION_TRIGGER;
            em.persist(ccbTriggerEntity);
            const ccbTrigger = new CcbPreventionTrigger(context, contexts, address);
            return ccbTrigger;
        });
    }

    static async fromEntity(context: IAssetBotContext, contexts: Map<number, IAssetBotContext>, ccbTriggerEntity: ActorEntity) {
        return new CcbPreventionTrigger(context, contexts, ccbTriggerEntity.address);
    }

    async runStep(em: EM) {
        await this.registerEvents(em);
    }

    async registerEvents(rootEm: EM) {
        await rootEm.transactional(async em => {
            const liquidatorEnt = await em.findOneOrFail(ActorEntity, { address: this.address, type: ActorType.CCB_PREVENTION_TRIGGER } as FilterQuery<ActorEntity>);
            // Native chain events
            const events = await this.readUnhandledEvents(liquidatorEnt);
            // Note: only update db here, so that retrying on error won't retry on-chain operations.
            for (const event of events) {
                console.log(this.context.ftsoManager.address, event.address, event.event);
                if (eventIs(event, this.context.ftsoManager, 'PriceEpochFinalized')) {
                    await this.checkAllAgentsForColletaralRatio(rootEm)
                }
            }
            // checking for collateral ratio after every minting => is done in AgentBot.ts
        }).catch(error => {
            console.error(`Error handling events for challenger ${this.address}: ${error}`);
        });
    }

    async readUnhandledEvents(liquidatorEnt: ActorEntity): Promise<EvmEvent[]> {
        // get all logs for this challenger
        const nci = this.context.nativeChainInfo;
        const lastBlock = await web3.eth.getBlockNumber() - nci.finalizationBlocks;
        const events: EvmEvent[] = [];
        for (let lastHandled = liquidatorEnt.lastEventBlockHandled; lastHandled < lastBlock; lastHandled += nci.readLogsChunkSize) {
            const logs = await web3.eth.getPastLogs({
                address: this.context.assetManager.address,
                fromBlock: lastHandled + 1,
                toBlock: Math.min(lastHandled + nci.readLogsChunkSize, lastBlock),
                topics: [null]
            });
            events.push(...this.eventDecoder.decodeEvents(logs));
        }
        // mark as handled
        liquidatorEnt.lastEventBlockHandled = lastBlock;
        return events;
    }

    async checkAllAgentsForColletaralRatio(rootEm: EM) {
        const agentEntities = await rootEm.find(AgentEntity, { active: true } as FilterQuery<AgentEntity>);
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
