import { FilterQuery } from "@mikro-orm/core/typings";
import { AgentCreated, AgentDestroyed, MintingExecuted } from "../../typechain-truffle/AssetManager";
import { EM } from "../config/orm";
import { ActorEntity, ActorType } from "../entities/actor";
import { IAssetBotContext } from "../fasset-bots/IAssetBotContext";
import { AssetManagerSettings } from "../fasset/AssetManagerTypes";
import { Prices } from "../state/Prices";
import { TrackedAgent } from "../state/TrackedAgent";
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
        public address: string
    ) {}

    // must call initialize to init prices and settings
    prices!: Prices;
    trustedPrices!: Prices;
    // settings
    settings!: AssetManagerSettings;
    
    eventDecoder = new Web3EventDecoder({ ftsoManager: this.context.ftsoManager, assetManager: this.context.assetManager });
    // tracked agents
    agents: Map<string, TrackedAgent> = new Map();                // map agent_address => tracked agent
    agentsByUnderlying: Map<string, TrackedAgent> = new Map();    // map underlying_address => tracked agent
    
    // async initialization part
    async initialize() {
        this.settings = await this.context.assetManager.getSettings();
        [this.prices, this.trustedPrices] = await this.getPrices();
    }

    async getPrices(): Promise<[Prices, Prices]> {
        return await Prices.getPrices(this.context, this.settings);
    }

    static async create(runner: ScopedRunner, rootEm: EM, context: IAssetBotContext, address: string) {
        const lastBlock = await web3.eth.getBlockNumber();
        return await rootEm.transactional(async em => {
            const liquidationTriggerEntity = new ActorEntity();
            liquidationTriggerEntity.chainId = context.chainInfo.chainId;
            liquidationTriggerEntity.address = address;
            liquidationTriggerEntity.lastEventBlockHandled = lastBlock;
            liquidationTriggerEntity.type = ActorType.LIQUIDATION_TRIGGER;
            em.persist(liquidationTriggerEntity);
            const liquidationTrigger = new LiquidationTrigger(runner, context, address);
            return liquidationTrigger;
        });
    }

    static async fromEntity(runner: ScopedRunner, context: IAssetBotContext, ccbTriggerEntity: ActorEntity) {
        return new LiquidationTrigger(runner, context, ccbTriggerEntity.address);
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
                    this.createAgent(event.args);
                } else if (eventIs(event, this.context.assetManager, 'AgentDestroyed')) {
                    this.destroyAgent(event.args);
                } else if (eventIs(event, this.context.assetManager, "AgentInCCB")) {
                    await this.handleStatusChange(AgentStatus.CCB, event.args.vaultAddress, event.args.timestamp);
                } else if (eventIs(event, this.context.assetManager, 'LiquidationStarted')) {
                    await this.handleStatusChange(AgentStatus.LIQUIDATION, event.args.vaultAddress, event.args.timestamp);
                } else if (eventIs(event, this.context.assetManager, 'FullLiquidationStarted')) {
                    await this.handleStatusChange(AgentStatus.FULL_LIQUIDATION, event.args.vaultAddress, event.args.timestamp);
                } else if (eventIs(event, this.context.assetManager, 'LiquidationEnded')) {
                    await this.handleStatusChange(AgentStatus.NORMAL, event.args.vaultAddress);
                } else if (eventIs(event, this.context.assetManager, 'AgentDestroyAnnounced')) {
                    await this.handleStatusChange(AgentStatus.DESTROYING, event.args.vaultAddress, event.args.timestamp);
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

    createAgent(args: EventArgs<AgentCreated>) {
        const agent = new TrackedAgent(args.agentVault, args.owner, args.underlyingAddress);
        this.agents.set(agent.vaultAddress, agent);
        this.agentsByUnderlying.set(agent.underlyingAddress, agent);
        return agent;
    }

    destroyAgent(args: EventArgs<AgentDestroyed>) {
        const agent = this.getAgent(args.agentVault);
        if (agent) {
            this.agents.delete(args.agentVault);
            this.agentsByUnderlying.delete(agent.underlyingAddress);
        }
    }

    getAgent(address: string): TrackedAgent | undefined {
        return this.agents.get(address);
    }
    
    async handleMintingExecuted(args: EventArgs<MintingExecuted>) {
        const agent = this.getAgent(args.agentVault);
        if (!agent) return;
        this.runner.startThread(async (scope) => {
            await this.checkAgentForLiquidation(agent)
                .catch(e => scope.exitOnExpectedError(e, []));
        })
    }

    async checkAllAgentsForLiquidation() {
        for (const agent of this.agents.values()) {
            try {
                await this.checkAgentForLiquidation(agent);
            } catch (error) {
                console.error(`Error with agent ${agent.vaultAddress}`, error);
            }
        }
    }

    async handleStatusChange(status: AgentStatus, agentVault: string, timestamp?: BN): Promise<void> {
        const agent = this.getAgent(agentVault);
        if (!agent) return;
        const agentInfo = await this.context.assetManager.getAgentInfo(agent.vaultAddress);
        const agentStatus = Number(agentInfo.status);
        if (timestamp && agentStatus === AgentStatus.NORMAL && status === AgentStatus.CCB) {
            agent.ccbStartTimestamp = timestamp;
        }
        if (timestamp && (agentStatus === AgentStatus.NORMAL || agentStatus === AgentStatus.CCB) && (status === AgentStatus.LIQUIDATION || status === AgentStatus.FULL_LIQUIDATION)) {
            agent.liquidationStartTimestamp = timestamp;
        }
        agent.status = status;
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
