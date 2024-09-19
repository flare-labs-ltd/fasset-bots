import BN from "bn.js";
import { BotConfig, BotFAssetConfig, createLiquidatorContext } from "../config";
import { ActorBase } from "../fasset-bots/ActorBase";
import { ILiquidatorContext } from "../fasset-bots/IAssetBotContext";
import { AgentStatus } from "../fasset/AssetManagerTypes";
import { TrackedAgentState } from "../state/TrackedAgentState";
import { TrackedState } from "../state/TrackedState";
import { BN_ZERO, Currencies, formatFixed, squashSpace, toBN } from "../utils";
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
            await this.performLiquidations();
        } catch (error) {
            const fassetSymbol = this.context.fAssetSymbol;
            console.error(`Error handling events and performing liquidations for ${fassetSymbol} liquidator ${this.address}: ${error}`);
            logger.error(`Liquidator ${this.address} run into error while handling events and performing ${fassetSymbol} liquidations:`, error);
        } finally {
            this.handlingEvents = false;
        }
    }

    async performLiquidations() {
        const timestamp = await latestBlockTimestampBN();
        const liquidatingAgents = Array.from(this.state.agents.values())
            .filter(agent => this.checkAgentForLiquidation(agent, timestamp));
        if (liquidatingAgents.length > 0) {
            const fassetSymbol = this.context.fAssetSymbol;
            logger.info(`Liquidator ${this.address} performing ${fassetSymbol} liquidation on ${liquidatingAgents.length} agents.`);
            // sort by decreasing minted amount
            liquidatingAgents.sort((a, b) => -a.mintedUBA.cmp(b.mintedUBA));
            for (const agent of liquidatingAgents) {
                if (agent.mintedUBA.eq(BN_ZERO)) {
                    continue;
                }
                const fbalance = await this.context.fAsset.balanceOf(this.address);
                if (fbalance.eq(BN_ZERO)) {
                    logger.info(`Liquidator ${this.address} has zero ${fassetSymbol} balance, cannot liquidate ${agent.vaultAddress}.`);
                    console.log(`Liquidator ${this.address} has zero ${fassetSymbol} balance, cannot liquidate ${agent.vaultAddress}.`);
                    break;
                }
                await this.liquidateAgent(agent);
            }
        }
    }

    async liquidateAgent(agent: TrackedAgentState) {
        const before = await this.context.assetManager.getAgentInfo(agent.vaultAddress);
        await this.liquidationStrategy.liquidate(agent);
        const after = await this.context.assetManager.getAgentInfo(agent.vaultAddress);
        const diff = toBN(before.mintedUBA).sub(toBN(after.mintedUBA));
        const cur = await Currencies.fasset(this.context);
        const message = squashSpace`Liquidator ${this.address} liquidated agent ${agent.vaultAddress} for ${cur.format(diff)}.
            Minted before: ${cur.format(before.mintedUBA)}, after: ${cur.format(after.mintedUBA)}.
            Vault CR before: ${formatFixed(toBN(before.vaultCollateralRatioBIPS), 4)}, after: ${formatFixed(toBN(after.vaultCollateralRatioBIPS), 4)}.
            Pool CR before: ${formatFixed(toBN(before.poolCollateralRatioBIPS), 4)}, after: ${formatFixed(toBN(after.poolCollateralRatioBIPS), 4)}.`;
        logger.info(message);
        console.log(message);
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
            const fassetSymbol = this.context.fAssetSymbol;
            logger.info(`Liquidator ${this.address} found that ${fassetSymbol} agent ${agent.vaultAddress} has liquidation status.`);
            return true;
        }
        // not in liquidation
        return false;
    }
 }
