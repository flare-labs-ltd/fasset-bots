import { BotConfig, BotFAssetConfig, createLiquidatorContext } from "../config";
import { ActorBase, ActorBaseKind } from "../fasset-bots/ActorBase";
import { ILiquidatorContext } from "../fasset-bots/IAssetBotContext";
import { AgentStatus } from "../fasset/AssetManagerTypes";
import { TrackedAgentState } from "../state/TrackedAgentState";
import { TrackedState } from "../state/TrackedState";
import { iteratorToArray } from "../utils";
import { ScopedRunner } from "../utils/events/ScopedRunner";
import { eventIs } from "../utils/events/truffle";
import { formatArgs } from "../utils/formatting";
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
    checkedInitialAgents: boolean = false

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
        await this.registerEvents();
    }

    /**
     * Performs appropriate actions according to received native events and underlying transactions.
     */
    async registerEvents(): Promise<void> {
        try {
            // initially check if any agents can be liquidated
            await this.initialLiquidationStatusCheck();
            // Native chain events and update state events
            logger.info(`Liquidator ${this.address} started reading unhandled native events.`);
            const events = await this.state.readUnhandledEvents();
            logger.info(`Liquidator ${this.address} finished reading unhandled native events.`);
            for (const event of events) {
                if (eventIs(event, this.context.priceChangeEmitter, "PriceEpochFinalized")) {
                    logger.info(`Liquidator ${this.address} received event 'PriceEpochFinalized' with data ${formatArgs(event.args)}.`);
                    await this.checkAllAgentsForLiquidation();
                } else if (eventIs(event, this.context.assetManager, "MintingExecuted")) {
                    logger.info(`Liquidator ${this.address} received event 'MintingExecuted' with data ${formatArgs(event.args)}.`);
                    await this.handleMintingExecuted(event.args.agentVault);
                } else if (eventIs(event, this.context.assetManager, "FullLiquidationStarted")) {
                    logger.info(`Liquidator ${this.address} received event 'FullLiquidationStarted' with data ${formatArgs(event.args)}.`);
                    await this.handleFullLiquidationStarted(event.args.agentVault);
                }
            }
        } catch (error) {
            console.error(`Error handling events for liquidator ${this.address}: ${error}`);
            logger.error(`Liquidator ${this.address} run into error while handling events:`, error);
        }
    }

    /**
     * @param args event's MintingExecuted arguments
     */
    async handleMintingExecuted(agentVault: string): Promise<void> {
        const agent = await this.state.getAgentTriggerAdd(agentVault);
        this.runner.startThread(async (scope) => {
            await this.checkAgentForLiquidation(agent).catch((e) => scope.exitOnExpectedError(e, [], ActorBaseKind.LIQUIDATOR, this.address));
        });
    }

    /**
     * @param args event's FullLiquidationStarted arguments
     */
    async handleFullLiquidationStarted(agentVault: string): Promise<void> {
        const agent = await this.state.getAgentTriggerAdd(agentVault);
        this.runner.startThread(async (scope) => {
            await this.liquidateAgent(agent).catch((e) => scope.exitOnExpectedError(e, [], ActorBaseKind.LIQUIDATOR, this.address));
        });
    }

    async checkAllAgentsForLiquidation(): Promise<void> {
        await Promise.all(iteratorToArray(this.state.agents.values()).map(async (agent) => {
            try {
                await this.checkAgentForLiquidation(agent);
            } catch (error) {
                console.error(`Error with agent ${agent.vaultAddress}: ${error}`);
                logger.error(`Liquidator ${this.address} found error with agent ${agent.vaultAddress}:`, error);
            }
        }));
    }

    /**
     * Checks if agent's status. If status is LIQUIDATION, then liquidate agent with all of the liquidator's fAssets.
     * @param agent instance of TrackedAgentState
     */
    private async checkAgentForLiquidation(agent: TrackedAgentState): Promise<void> {
        logger.info(`Liquidator ${this.address} started checking agent ${agent.vaultAddress} for liquidation.`);
        console.log(`Liquidator ${this.address} started checking agent ${agent.vaultAddress} for liquidation.`);
        const timestamp = await latestBlockTimestampBN();
        const newStatus = agent.possibleLiquidationTransition(timestamp);
        console.log(`Agent ${agent.vaultAddress} has status ${newStatus}.`);
        if (newStatus === AgentStatus.LIQUIDATION) {
            await this.liquidateAgent(agent);
        }
        logger.info(`Liquidator ${this.address} finished checking agent ${agent.vaultAddress} for liquidation.`);
        console.log(`Liquidator ${this.address} finished checking agent ${agent.vaultAddress} for liquidation.`);
    }

    private async liquidateAgent(agent: TrackedAgentState): Promise<void> {
        if (!await this.hasEnoughBalanceToStartLiquidation()) {
            logger.info(`Liquidator ${this.address} does not have enough FAssets to liquidate agent ${agent.vaultAddress}.`);
            console.log(`Liquidator ${this.address} does not have enough FAssets to liquidate agent ${agent.vaultAddress}.`)
            return;
        }
        await this.liquidationStrategy.liquidate(agent);
        logger.info(`Liquidator ${this.address} liquidated agent ${agent.vaultAddress}.`);
        await this.notifier.sendAgentLiquidated(agent.vaultAddress);
        console.log(`Liquidator ${this.address} liquidated agent ${agent.vaultAddress}.`);
    }

    private async hasEnoughBalanceToStartLiquidation(): Promise<boolean> {
        // TODO: check if balance is larger or equal to 1 AMG
        const balance = await this.context.fAsset.balanceOf(this.address);
        return balance.gtn(0);
    }

    private async initialLiquidationStatusCheck() {
        if (!this.checkedInitialAgents) {
            await this.checkAllAgentsForLiquidation();
            this.checkedInitialAgents = true;
        }
    }
 }
