import { MintingExecuted } from "../../typechain-truffle/AssetManager";
import { TrackedAgentState } from "../state/TrackedAgentState";
import { TrackedState } from "../state/TrackedState";
import { EventArgs } from "../utils/events/common";
import { ScopedRunner } from "../utils/events/ScopedRunner";
import { eventIs } from "../utils/events/truffle";
import { latestBlockTimestampBN } from "../utils/web3helpers";
import { AgentStatus } from "./AgentBot";

export class Liquidator {
    constructor(
        public runner: ScopedRunner,
        public address: string,
        public state: TrackedState,
    ) { }

    async runStep(): Promise<void> {
        await this.registerEvents();
    }

    async registerEvents(): Promise<void> {
        try {
            // Native chain events and update state events
            const events = await this.state.readUnhandledEvents();
            for (const event of events) {
                if (eventIs(event, this.state.context.ftsoManager, 'PriceEpochFinalized')) {
                    await this.checkAllAgentsForLiquidation();
                } else if (eventIs(event, this.state.context.assetManager, 'MintingExecuted')) {
                    await this.handleMintingExecuted(event.args);
                }
            }
        } catch (error) {
            console.error(`Error handling events for liquidator ${this.address}: ${error}`);
        };
    }

    async handleMintingExecuted(args: EventArgs<MintingExecuted>): Promise<void> {
        const agent = await this.state.getAgentTriggerAdd(args.agentVault);
        agent.handleMintingExecuted(args);
        this.runner.startThread(async (scope) => {
            await this.checkAgentForLiquidation(agent)
                .catch(e => scope.exitOnExpectedError(e, []));
        })
    }

    async checkAllAgentsForLiquidation(): Promise<void> {
        for (const agent of this.state.agents.values()) {
            try {
                await this.checkAgentForLiquidation(agent);
            } catch (error) {
                console.error(`Error with agent ${agent.vaultAddress}`, error);
            }
        }
    }

    private async checkAgentForLiquidation(agent: TrackedAgentState): Promise<void> {
        const timestamp = await latestBlockTimestampBN();
        const newStatus = await agent.possibleLiquidationTransition(timestamp);
        if (newStatus === AgentStatus.LIQUIDATION) {
            const fBalance = await this.state.context.fAsset.balanceOf(this.address);
            await this.state.context.assetManager.liquidate(agent.vaultAddress, fBalance, { from: this.address });
        }
    }

}
