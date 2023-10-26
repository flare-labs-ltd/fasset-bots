import { ActorBase } from "../fasset-bots/ActorBase";
import { AgentStatus } from "../fasset/AssetManagerTypes";
import { TrackedAgentState } from "../state/TrackedAgentState";
import { TrackedState } from "../state/TrackedState";
import { ScopedRunner } from "../utils/events/ScopedRunner";
import { eventIs } from "../utils/events/truffle";
import { formatArgs } from "../utils/formatting";
import { logger } from "../utils/logger";
import { latestBlockTimestampBN } from "../utils/web3helpers";

export class Liquidator extends ActorBase {
    constructor(
        public runner: ScopedRunner,
        public address: string,
        public state: TrackedState
    ) {
        super(runner, address, state);
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
            // Native chain events and update state events
            logger.info(`Liquidator ${this.address} started reading unhandled native events.`);
            const events = await this.state.readUnhandledEvents();
            logger.info(`Liquidator ${this.address} finished reading unhandled native events.`);
            for (const event of events) {
                if (eventIs(event, this.state.context.priceChangeEmitter, "PriceEpochFinalized")) {
                    logger.info(`Liquidator ${this.address} received event 'PriceEpochFinalized' with data ${formatArgs(event.args)}.`);
                    await this.checkAllAgentsForLiquidation();
                } else if (eventIs(event, this.state.context.assetManager, "MintingExecuted")) {
                    logger.info(`Liquidator ${this.address} received event 'MintingExecuted' with data ${formatArgs(event.args)}.`);
                    await this.handleMintingExecuted(event.args.agentVault);
                } else if (eventIs(event, this.state.context.assetManager, "FullLiquidationStarted")) {
                    logger.info(`Liquidator ${this.address} received event 'FullLiquidationStarted' with data ${formatArgs(event.args)}.`);
                    await this.handleFullLiquidationStarted(event.args.agentVault);
                }
            }
        } catch (error) {
            console.error(`Error handling events for liquidator ${this.address}: ${error}`);
            logger.error(`Liquidator ${this.address} run into error while handling events: ${error}`);
        }
    }

    /**
     * @param args event's MintingExecuted arguments
     */
    async handleMintingExecuted(agentVault: string): Promise<void> {
        const agent = await this.state.getAgentTriggerAdd(agentVault);
        this.runner.startThread(async (scope) => {
            await this.checkAgentForLiquidation(agent).catch((e) => scope.exitOnExpectedError(e, []));
        });
    }

    /**
     * @param args event's FullLiquidationStarted arguments
     */
    async handleFullLiquidationStarted(agentVault: string): Promise<void> {
        const agent = await this.state.getAgentTriggerAdd(agentVault);
        this.runner.startThread(async (scope) => {
            await this.liquidateAgent(agent).catch((e) => scope.exitOnExpectedError(e, []));
        });
    }

    async checkAllAgentsForLiquidation(): Promise<void> {
        for (const agent of this.state.agents.values()) {
            try {
                await this.checkAgentForLiquidation(agent);
            } catch (error) {
                console.error(`Error with agent ${agent.vaultAddress}: ${error}`);
                logger.error(`Liquidator ${this.address} found error with agent ${agent.vaultAddress}: ${error}`);
            }
        }
    }

    /**
     * Checks if agent's status. If status is LIQUIDATION, then liquidate agent with all of the liquidator's fAssets.
     * @param agent instance of TrackedAgentState
     */
    private async checkAgentForLiquidation(agent: TrackedAgentState): Promise<void> {
        logger.info(`Liquidator ${this.address} started checking agent ${agent.vaultAddress} for liquidation.`);
        const timestamp = await latestBlockTimestampBN();
        const newStatus = agent.possibleLiquidationTransition(timestamp);
        console.log(`Agent ${agent.vaultAddress} has status ${newStatus}.`);
        if (newStatus === AgentStatus.LIQUIDATION) {
            await this.liquidateAgent(agent);
        }
        logger.info(`Liquidator ${this.address} finished checking agent ${agent.vaultAddress} for liquidation.`);
    }

    private async liquidateAgent(agent: TrackedAgentState): Promise<void> {
        const fBalance = await this.state.context.fAsset.balanceOf(this.address);
        await this.state.context.assetManager.liquidate(agent.vaultAddress, fBalance, { from: this.address });
        logger.info(`Liquidator ${this.address} liquidated agent ${agent.vaultAddress}.`);
    }
}
