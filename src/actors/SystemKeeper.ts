import { MintingExecuted } from "../../typechain-truffle/AssetManager";
import { TrackedAgentState } from "../state/TrackedAgentState";
import { TrackedState } from "../state/TrackedState";
import { EventArgs } from "../utils/events/common";
import { ScopedRunner } from "../utils/events/ScopedRunner";
import { eventIs } from "../utils/events/truffle";
import { latestBlockTimestampBN } from "../utils/web3helpers";
import { AgentStatus } from "./AgentBot";

export class SystemKeeper {
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
                } else if (eventIs(event, this.state.context.assetManager, "AgentInCCB")) {
                    await this.handleStatusChange(AgentStatus.CCB, event.args.agentVault, event.args.timestamp);
                } else if (eventIs(event, this.state.context.assetManager, 'LiquidationStarted')) {
                    await this.handleStatusChange(AgentStatus.LIQUIDATION, event.args.agentVault, event.args.timestamp);
                } else if (eventIs(event, this.state.context.assetManager, 'FullLiquidationStarted')) {
                    await this.handleStatusChange(AgentStatus.FULL_LIQUIDATION, event.args.agentVault, event.args.timestamp);
                } else if (eventIs(event, this.state.context.assetManager, 'LiquidationEnded')) {
                    await this.handleStatusChange(AgentStatus.NORMAL, event.args.agentVault);
                } else if (eventIs(event, this.state.context.assetManager, 'AgentDestroyAnnounced')) {
                    await this.handleStatusChange(AgentStatus.DESTROYING, event.args.agentVault, event.args.timestamp);
                }
            }
        } catch (error) {
            console.error(`Error handling events for system keeper ${this.address}: ${error}`);
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

    async handleStatusChange(status: AgentStatus, agentVault: string, timestamp?: BN): Promise<void> {
        const agent = await this.state.getAgentTriggerAdd(agentVault);
        agent.handleStatusChange(status, timestamp);
    }

    private async checkAgentForLiquidation(agent: TrackedAgentState): Promise<void> {
        const timestamp = await latestBlockTimestampBN();
        const newStatus = await agent.possibleLiquidationTransition(timestamp);
        if (newStatus > agent.status) {
            await this.state.context.assetManager.startLiquidation(agent.vaultAddress, { from: this.address });
        } else if (newStatus < agent.status) {
            await this.state.context.assetManager.endLiquidation(agent.vaultAddress, { from: this.address });
        }
    }

}
