import { MintingExecuted } from "../../typechain-truffle/AssetManager";
import { ActorBase } from "../fasset-bots/ActorBase";
import { AgentStatus } from "../fasset/AssetManagerTypes";
import { TrackedAgentState } from "../state/TrackedAgentState";
import { TrackedState } from "../state/TrackedState";
import { EventArgs } from "../utils/events/common";
import { ScopedRunner } from "../utils/events/ScopedRunner";
import { eventIs } from "../utils/events/truffle";
import { formatArgs } from "../utils/formatting";
import { logger } from "../utils/logger";
import { latestBlockTimestampBN } from "../utils/web3helpers";

export class SystemKeeper extends ActorBase {
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
            logger.info(`SystemKeeper ${this.address} started reading unhandled native events.`);
            const events = await this.state.readUnhandledEvents();
            logger.info(`SystemKeeper ${this.address} finished reading unhandled native events.`);
            for (const event of events) {
                if (eventIs(event, this.state.context.priceChangeEmitter, "PriceEpochFinalized")) {
                    logger.info(`SystemKeeper ${this.address} received event 'PriceEpochFinalized' with data ${formatArgs(event.args)}.`);
                    await this.checkAllAgentsForLiquidation();
                } else if (eventIs(event, this.state.context.assetManager, "MintingExecuted")) {
                    logger.info(`SystemKeeper ${this.address} received event 'MintingExecuted' with data ${formatArgs(event.args)}.`);
                    await this.handleMintingExecuted(event.args);
                }
            }
        } catch (error) {
            console.error(`Error handling events for system keeper ${this.address}: ${error}`);
            logger.error(`SystemKeeper ${this.address} run into error while handling events: ${error}`);
        }
    }

    /**
     * @param args event's MintingExecuted arguments
     */
    async handleMintingExecuted(args: EventArgs<MintingExecuted>): Promise<void> {
        const agent = await this.state.getAgentTriggerAdd(args.agentVault);
        this.runner.startThread(async (scope) => {
            await this.checkAgentForLiquidation(agent).catch((e) => scope.exitOnExpectedError(e, []));
        });
    }

    async checkAllAgentsForLiquidation(): Promise<void> {
        for (const agent of this.state.agents.values()) {
            try {
                await this.checkAgentForLiquidation(agent);
            } catch (error) {
                console.error(`Error with agent ${agent.vaultAddress}: ${error}`);
                logger.error(`SystemKeeper ${this.address} found error with agent ${agent.vaultAddress}: ${error}`);
            }
        }
    }

    /**
     * Checks agent's status and start or end liquidation accordingly to agent's status.
     * @param agent instance of TrackedAgentState
     */
    private async checkAgentForLiquidation(agent: TrackedAgentState): Promise<void> {
        logger.info(`SystemKeeper ${this.address} started checking agent ${agent.vaultAddress} for liquidation.`);
        const timestamp = await latestBlockTimestampBN();
        const newStatus = agent.possibleLiquidationTransition(timestamp);
        if (newStatus > agent.status) {
            await this.state.context.assetManager.startLiquidation(agent.vaultAddress, { from: this.address });
            logger.info(
                `SystemKeeper ${this.address} started liquidation for agent ${agent.vaultAddress}. Agent's status changed from ${
                    AgentStatus[agent.status]
                } to ${AgentStatus[newStatus]}.`
            );
        } else if (newStatus < agent.status) {
            await this.state.context.assetManager.endLiquidation(agent.vaultAddress, { from: this.address });
            logger.info(
                `SystemKeeper ${this.address} ended liquidation for agent ${agent.vaultAddress}. Agent's status changed from ${AgentStatus[agent.status]} to ${
                    AgentStatus[newStatus]
                }.`
            );
        }
        logger.info(`SystemKeeper ${this.address} finished checking agent ${agent.vaultAddress} for liquidation.`);
    }
}
