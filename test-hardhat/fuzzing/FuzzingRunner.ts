import { AgentBot } from "../../src/actors/AgentBot";
import { AvailableAgentInfo } from "../../src/fasset/AssetManagerTypes";
import { TrackedState } from "../../src/state/TrackedState";
import { ScopedRunner } from "../../src/utils/events/ScopedRunner";
import { EventFormatter } from "../test-utils/EventFormatter";
import { TestAssetBotContext } from "../test-utils/create-test-asset-context";
import { FuzzingCustomer } from "./FuzzingCustomer";
import chalk from 'chalk';

export class FuzzingRunner extends ScopedRunner {
    constructor(
        public context: TestAssetBotContext,
        public avoidErrors: boolean,
        public commonTrackedState: TrackedState,
        public eventFormatter: EventFormatter
    ) {
        super();
    }

    agentBots: AgentBot[] = [];
    customers: FuzzingCustomer[] = [];
    availableAgentBots: AvailableAgentInfo[] = [];

    async refreshAvailableAgentBots() {
        const { 0: _availableAgents } = await this.context.assetManager.getAvailableAgentsDetailedList(0, 1000);
        this.availableAgentBots = _availableAgents;
    }

    comment(comment: string, actor?: string) {
        if (actor) {
            console.log(chalk.yellow(actor + ":"), comment);
        } else {
            console.log(comment);
        }

    }
}
