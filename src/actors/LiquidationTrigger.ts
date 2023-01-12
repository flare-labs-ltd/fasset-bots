import { FilterQuery } from "@mikro-orm/core/typings";
import { MintingExecuted } from "../../typechain-truffle/AssetManager";
import { EM } from "../config/orm";
import { ActorEntity, ActorType } from "../entities/actor";
import { IAssetBotContext } from "../fasset-bots/IAssetBotContext";
import { AssetManagerSettings } from "../fasset/AssetManagerTypes";
import { Prices } from "../state/Prices";
import { TrackedAgent } from "../state/TrackedAgent";
import { TrackedState } from "../state/TrackedState";
import { EventArgs, EvmEvent } from "../utils/events/common";
import { ScopedRunner } from "../utils/events/ScopedRunner";
import { eventIs } from "../utils/events/truffle";
import { Web3EventDecoder } from "../utils/events/Web3EventDecoder";
import { web3 } from "../utils/web3";
import { latestBlockTimestampBN } from "../utils/web3helpers";
import { AgentStatus } from "./AgentBot";

export class LiquidationTrigger {
    constructor(
        public runner: ScopedRunner,
        public context: IAssetBotContext,
        public address: string,
        public state: TrackedState
    ) {}

    // must call initialize to init prices and settings
    prices!: Prices;
    trustedPrices!: Prices;
    // settings
    settings!: AssetManagerSettings;
    
    eventDecoder = new Web3EventDecoder({ ftsoManager: this.context.ftsoManager, assetManager: this.context.assetManager });
    
    // async initialization part
    async initialize() {
        this.settings = await this.context.assetManager.getSettings();
        [this.prices, this.trustedPrices] = await this.getPrices();
    }

    async getPrices(): Promise<[Prices, Prices]> {
        return await Prices.getPrices(this.context, this.settings);
    }

    static async create(runner: ScopedRunner, rootEm: EM, context: IAssetBotContext, address: string, state: TrackedState) {
        const lastBlock = await web3.eth.getBlockNumber();
        return await rootEm.transactional(async em => {
            const liquidationTriggerEntity = new ActorEntity();
            liquidationTriggerEntity.chainId = context.chainInfo.chainId;
            liquidationTriggerEntity.address = address;
            liquidationTriggerEntity.lastEventBlockHandled = lastBlock;
            liquidationTriggerEntity.type = ActorType.LIQUIDATION_TRIGGER;
            em.persist(liquidationTriggerEntity);
            const liquidationTrigger = new LiquidationTrigger(runner, context, address, state);
            return liquidationTrigger;
        });
    }

    static async fromEntity(runner: ScopedRunner, context: IAssetBotContext, ccbTriggerEntity: ActorEntity, state: TrackedState) {
        return new LiquidationTrigger(runner, context, ccbTriggerEntity.address, state);
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
                // console.log(this.context.ftsoManager.address, this.context.assetManager.address, event.address, event.event);
                if (eventIs(event, this.context.ftsoManager, 'PriceEpochFinalized')) {
                    // refresh prices
                    [this.prices, this.trustedPrices] = await this.getPrices();
                    await this.checkAllAgentsForLiquidation();
                } else if (eventIs(event, this.context.assetManager, 'MintingExecuted')) {
                    await this.handleMintingExecuted(event.args);
                } else if (eventIs(event, this.context.assetManager, 'AgentCreated')) {
                    this.state.createAgent(event.args);
                } else if (eventIs(event, this.context.assetManager, 'AgentDestroyed')) {
                    this.state.destroyAgent(event.args);
                } else if (eventIs(event, this.context.assetManager, "AgentInCCB")) {
                    this.handleStatusChange(AgentStatus.CCB, event.args.agentVault, event.args.timestamp);
                } else if (eventIs(event, this.context.assetManager, 'LiquidationStarted')) {
                    this.handleStatusChange(AgentStatus.LIQUIDATION, event.args.agentVault, event.args.timestamp);
                } else if (eventIs(event, this.context.assetManager, 'FullLiquidationStarted')) {
                    this.handleStatusChange(AgentStatus.FULL_LIQUIDATION, event.args.agentVault, event.args.timestamp);
                } else if (eventIs(event, this.context.assetManager, 'LiquidationEnded')) {
                    this.handleStatusChange(AgentStatus.NORMAL, event.args.agentVault);
                } else if (eventIs(event, this.context.assetManager, 'AgentDestroyAnnounced')) {
                    this.handleStatusChange(AgentStatus.DESTROYING, event.args.agentVault, event.args.timestamp);
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
    
    async handleMintingExecuted(args: EventArgs<MintingExecuted>) {
        const agent = this.state.getAgent(args.agentVault);
        if (!agent) return;
        this.runner.startThread(async (scope) => {
            await this.checkAgentForLiquidation(agent)
                .catch(e => scope.exitOnExpectedError(e, []));
        })
    }

    async checkAllAgentsForLiquidation() {
        for (const agent of this.state.agents.values()) {
            try {
                await this.checkAgentForLiquidation(agent);
            } catch (error) {
                console.error(`Error with agent ${agent.vaultAddress}`, error);
            }
        }
    }

    handleStatusChange(status: AgentStatus, agentVault: string, timestamp?: BN): void {
        const agent = this.state.getAgent(agentVault);
        if (!agent) return;
        agent.handleStatusChange(status, timestamp);
    }

    private async checkAgentForLiquidation(agent: TrackedAgent) {
        const timestamp = await latestBlockTimestampBN();
        const agentInfo = await this.context.assetManager.getAgentInfo(agent.vaultAddress);
        const agentStatus = Number(agentInfo.status);
        const settings = await this.context.assetManager.getSettings();
        const newStatus = await agent.possibleLiquidationTransition(timestamp, settings, agentInfo, this.prices, this.trustedPrices);
        if (newStatus > agentStatus) {
            await this.context.assetManager.startLiquidation(agent.vaultAddress, { from: this.address });
        } else if (newStatus < agentStatus) {
            await this.context.assetManager.endLiquidation(agent.vaultAddress, { from: this.address });
        }
    }

}
