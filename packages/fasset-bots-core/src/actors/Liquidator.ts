import BN from "bn.js";
import { BotConfig, BotFAssetConfig, createLiquidatorContext } from "../config";
import { ActorBase } from "../fasset-bots/ActorBase";
import { ILiquidatorContext } from "../fasset-bots/IAssetBotContext";
import { AgentStatus } from "../fasset/AssetManagerTypes";
import { TrackedAgentState } from "../state/TrackedAgentState";
import { TrackedState } from "../state/TrackedState";
import { BN_ZERO } from "../utils";
import { ScopedRunner } from "../utils/events/ScopedRunner";
import { logger } from "../utils/logger";
import { NotifierTransport } from "../utils/notifier/BaseNotifier";
import { LiquidatorNotifier } from "../utils/notifier/LiquidatorNotifier";
import { web3 } from "../utils/web3";
import { latestBlockTimestampBN } from "../utils/web3helpers";
import { DefaultLiquidationStrategy, LiquidationStrategy } from "./plugins/LiquidationStrategy";

export class Liquidator extends ActorBase {
    static deepCopyWithObjectCreate = true;

    notifier: LiquidatorNotifier;
    liquidationStrategy: LiquidationStrategy;

    constructor(
        public context: ILiquidatorContext,
        public runner: ScopedRunner,
        public address: string,
        public state: TrackedState,
        notifierTransports: NotifierTransport[]
    ) {
        super(runner, address, state);
        this.notifier = new LiquidatorNotifier(this.address, notifierTransports);
        if (context.liquidationStrategy === undefined) {
            this.liquidationStrategy = new DefaultLiquidationStrategy(context, state, address);
        } else {
            // eslint-disable-next-line @typescript-eslint/no-var-requires
            const strategies = require("./plugins/LiquidationStrategy");
            this.liquidationStrategy = new strategies[context.liquidationStrategy.className](context, state, address);
        }
    }

    static async create(config: BotConfig, address: string, fAsset: BotFAssetConfig): Promise<Liquidator> {
        logger.info(`Liquidator ${address} started to create asset context.`);
        const context = await createLiquidatorContext(config, fAsset);
        logger.info(`Liquidator ${address} initialized asset context.`);
        const lastBlock = await web3.eth.getBlockNumber();
        const trackedState = new TrackedState(context, lastBlock);
        await trackedState.initialize(true);
        logger.info(`Liquidator ${address} initialized tracked state.`);
        return new Liquidator(context, new ScopedRunner(), address, trackedState, config.notifiers);
    }

    /**
     * This is the main method, where "automatic" logic is gathered.
     * It collects unhandled events on native chain, runs through them and handles them appropriately.
     */
    override async runStep(): Promise<void> {
        await this.handleEvents();
    }

    handlingEvents: boolean = false;

    /**
     * Performs appropriate actions according to received native events and underlying transactions.
     */
    async handleEvents(): Promise<void> {
        if (this.handlingEvents) return;
        this.handlingEvents = true;
        try {
            // Native chain events and update state events
            logger.info(`Liquidator ${this.address} started reading unhandled native events.`);
            await this.state.readUnhandledEvents();
            logger.info(`Liquidator ${this.address} finished reading unhandled native events.`);
            // perform liquidations
            await this.handleLiquidations();
        } catch (error) {
            const fassetSymbol = this.context.fAssetSymbol;
            console.error(`Error handling events and performing liquidations for ${fassetSymbol} liquidator ${this.address}: ${error}`);
            logger.error(`Liquidator ${this.address} run into error while handling events and performing ${fassetSymbol} liquidations:`, error);
        } finally {
            this.handlingEvents = false;
        }
    }

    async handleLiquidations() {
        const timestamp = await latestBlockTimestampBN();
        const agentCandidates = Array.from(this.state.agents.values()).filter(agent => agent.mintedUBA.gt(BN_ZERO));
        const liquidatingAgents = agentCandidates.filter(agent => this.checkAgentForLiquidation(agent, timestamp));
        const ccbAgents = agentCandidates.filter(agent => !liquidatingAgents.includes(agent) && agent.candidateForCcbLiquidation(timestamp));
        await this.liquidationStrategy.performLiquidations([...liquidatingAgents, ...ccbAgents]);
        const agentsInCcb = agentCandidates.filter(agent => !liquidatingAgents.includes(agent) && agent.candidateForCcbRegister(timestamp));
        await this.registerCCBs(agentsInCcb);
    }

    async registerCCBs(agents: TrackedAgentState[]) {
        for (const agent of agents) {
            try {
                logger.info(`Liquidator ${this.address} registering ${this.context.fAssetSymbol} CCB liquidation of agent ${agent.vaultAddress}.`);
                await this.context.assetManager.startLiquidation(agent.vaultAddress);
            } catch (e) {
                logger.error(`Liquidator ${this.address} failed to register CCB liquidation of agent ${agent.vaultAddress}: ${e}`);
                console.error(`Liquidator ${this.address} failed to register CCB liquidation of agent ${agent.vaultAddress}`);
            }
        }
    }

    /**
     * Checks if agent's status. If status is LIQUIDATION, then liquidate agent with all of the liquidator's fAssets.
     * @param agent instance of TrackedAgentState
     */
    checkAgentForLiquidation(agent: TrackedAgentState, timestamp: BN): boolean {
        if (agent.status === AgentStatus.LIQUIDATION || agent.status === AgentStatus.FULL_LIQUIDATION) {
            return true;
        }
        const newStatus = agent.possibleLiquidationTransition(timestamp);
        if (newStatus === AgentStatus.LIQUIDATION) {
            logger.info(`Liquidator ${this.address} found that ${this.context.fAssetSymbol} agent ${agent.vaultAddress} has liquidation status.`);
            return true;
        }
        // not in liquidation
        return false;
    }
 }
