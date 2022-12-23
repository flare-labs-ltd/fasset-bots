import { FilterQuery } from "@mikro-orm/core/typings";
import { MintingExecuted } from "../../typechain-truffle/AssetManager";
import { EM } from "../config/orm";
import { ActorEntity, ActorType } from "../entities/actor";
import { AgentEntity } from "../entities/agent";
import { IAssetBotContext } from "../fasset-bots/IAssetBotContext";
import { EventArgs, EvmEvent } from "../utils/events/common";
import { eventIs } from "../utils/events/truffle";
import { Web3EventDecoder } from "../utils/events/Web3EventDecoder";
import { web3 } from "../utils/web3";
import { latestBlockTimestampBN } from "../utils/web3helpers";
import { AgentBot } from "./AgentBot";

export class LiquidationTrigger {
    constructor(
        public context: IAssetBotContext,
        public address: string
    ) {}

    eventDecoder = new Web3EventDecoder({ ftsoManager: this.context.ftsoManager, assetManager: this.context.assetManager });
    
    static async create(rootEm: EM, context: IAssetBotContext, address: string) {
        const lastBlock = await web3.eth.getBlockNumber();
        return await rootEm.transactional(async em => {
            const liquidationTriggerEntity = new ActorEntity();
            liquidationTriggerEntity.chainId = context.chainInfo.chainId;
            liquidationTriggerEntity.address = address;
            liquidationTriggerEntity.lastEventBlockHandled = lastBlock;
            liquidationTriggerEntity.type = ActorType.LIQUIDATION_TRIGGER;
            em.persist(liquidationTriggerEntity);
            const liquidationTrigger = new LiquidationTrigger(context, address);
            return liquidationTrigger;
        });
    }

    static async fromEntity(context: IAssetBotContext, ccbTriggerEntity: ActorEntity) {
        return new LiquidationTrigger(context, ccbTriggerEntity.address);
    }

    async runStep(em: EM) {
        await this.registerEvents(em);
    }

    async registerEvents(rootEm: EM) {
        await rootEm.transactional(async em => {
            const liquidatorEnt = await em.findOneOrFail(ActorEntity, { address: this.address, type: ActorType.LIQUIDATION_TRIGGER } as FilterQuery<ActorEntity>);
            // Native chain events
            const events = await this.readUnhandledEvents(liquidatorEnt);
            // Note: only update db here, so that retrying on error won't retry on-chain operations.
            for (const event of events) {
                console.log(this.context.ftsoManager.address, this.context.assetManager.address, event.address, event.event);
                if (eventIs(event, this.context.ftsoManager, 'PriceEpochFinalized')) {
                    await this.checkAllAgentsForLiquidation(em);
                } else if (eventIs(event, this.context.assetManager, 'MintingExecuted')) {
                    await this.handleMintingExecuted(em, event.args);
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

    async handleMintingExecuted(em: EM, args: EventArgs<MintingExecuted>) {
        const agentEntity = await em.findOneOrFail(AgentEntity, { vaultAddress: args.agentVault } as FilterQuery<AgentEntity>);
        const agentBot = await AgentBot.fromEntity(this.context, agentEntity);
        await this.checkAgentForLiquidation(agentBot);
    }

    async checkAllAgentsForLiquidation(rootEm: EM) {
        const agentEntities = await rootEm.find(AgentEntity, { active: true, chainId: this.context.chainInfo.chainId } as FilterQuery<AgentEntity>);
        for (const agentEntity of agentEntities) {
            try {
                const agentBot = await AgentBot.fromEntity(this.context, agentEntity);
                await this.checkAgentForLiquidation(agentBot);
            } catch (error) {
                console.error(`Error with agent ${agentEntity.vaultAddress}`, error);
            }
        }
    }

    private async checkAgentForLiquidation(agentBot: AgentBot) {
        const timestamp = await latestBlockTimestampBN();
        const newStatus = await agentBot.possibleLiquidationTransition(timestamp);
        const agentStatus = Number((await agentBot.agent.getAgentInfo()).status);
        if (newStatus > agentStatus) {
            await this.context.assetManager.startLiquidation(agentBot.agent.vaultAddress, { from: this.address });
        } else if (newStatus < agentStatus) {
            await this.context.assetManager.endLiquidation(agentBot.agent.vaultAddress, { from: this.address });
        }
    }
}
