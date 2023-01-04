import { FilterQuery } from "@mikro-orm/core";
import { EM } from "../config/orm";
import { AgentEntity } from "../entities/agent";
import { ActorEntity, ActorType } from "../entities/actor";
import { IAssetBotContext } from "../fasset-bots/IAssetBotContext";
import { EvmEvent } from "../utils/events/common";
import { eventIs } from "../utils/events/truffle";
import { CCB_LIQUIDATION_PREVENTION_FACTOR, toBN } from "../utils/helpers";
import { AgentBot } from "./AgentBot";
import { web3 } from "../utils/web3";
import { Web3EventDecoder } from "../utils/events/Web3EventDecoder";

export class CcbPreventionTrigger {
    constructor(
        public context: IAssetBotContext,
        public address: string
    ) {}

    eventDecoder = new Web3EventDecoder({ ftsoManager: this.context.ftsoManager, assetManager: this.context.assetManager });
    
    static async create(rootEm: EM, context: IAssetBotContext, address: string) {
        const lastBlock = await web3.eth.getBlockNumber();
        return await rootEm.transactional(async em => {
            const ccbTriggerEntity = new ActorEntity();
            ccbTriggerEntity.chainId = context.chainInfo.chainId;
            ccbTriggerEntity.address = address;
            ccbTriggerEntity.lastEventBlockHandled = lastBlock;
            ccbTriggerEntity.type = ActorType.CCB_PREVENTION_TRIGGER;
            em.persist(ccbTriggerEntity);
            const ccbTrigger = new CcbPreventionTrigger(context, address);
            return ccbTrigger;
        });
    }

    static async fromEntity(context: IAssetBotContext, ccbTriggerEntity: ActorEntity) {
        return new CcbPreventionTrigger(context, ccbTriggerEntity.address);
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
                // console.log(this.context.ftsoManager.address, this.context.assetManager.address, event.address, event.event);
                if (eventIs(event, this.context.ftsoManager, 'PriceEpochFinalized')) {
                    await this.checkAllAgentsForColletaralRatio(em);
                }
            }
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
            const logsAssetManager = await web3.eth.getPastLogs({
                address: this.context.assetManager.address,
                fromBlock: lastHandled + 1,
                toBlock: Math.min(lastHandled + nci.readLogsChunkSize, lastBlock),
                topics: [null]
            });
            events.push(...this.eventDecoder.decodeEvents(logsAssetManager));
            const logsFtsoManager = await web3.eth.getPastLogs({
                address: this.context.ftsoManager.address,
                fromBlock: lastHandled + 1,
                toBlock: Math.min(lastHandled + nci.readLogsChunkSize, lastBlock),
                topics: [null]
            });
            events.push(...this.eventDecoder.decodeEvents(logsFtsoManager));
        }
        // mark as handled
        liquidatorEnt.lastEventBlockHandled = lastBlock;
        return events;
    }

    async checkAllAgentsForColletaralRatio(rootEm: EM) {
        const agentEntities = await rootEm.find(AgentEntity, { active: true, chainId: this.context.chainInfo.chainId } as FilterQuery<AgentEntity>);
        for (const agentEntity of agentEntities) {
            try {
                const agentBot = await AgentBot.fromEntity(this.context, agentEntity);
                await this.checkAgentForCollateralRatio(agentBot);
            } catch (error) {
                console.error(`Error with agent ${agentEntity.vaultAddress}`, error);
            }
        }
    }

    private async checkAgentForCollateralRatio(agentBot: AgentBot) {
        const agentInfo = await agentBot.agent.getAgentInfo();
        const cr = toBN(agentInfo.collateralRatioBIPS);
        const settings = await agentBot.agent.context.assetManager.getSettings();
        const minCollateralRatioBIPS = toBN(settings.minCollateralRatioBIPS);
        if (cr.lte(minCollateralRatioBIPS.muln(CCB_LIQUIDATION_PREVENTION_FACTOR))) {
            await agentBot.topupCollateral();
        }
    }
}
