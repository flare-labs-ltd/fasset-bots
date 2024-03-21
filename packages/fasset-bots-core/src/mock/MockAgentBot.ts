import { AgentBot } from "../actors/AgentBot";
import { Agent } from "../fasset/Agent";
import { AgentNotifier } from "../utils/notifier/AgentNotifier";

export class MockAgentBot extends AgentBot {
    constructor(
        public agent: Agent,
        public notifier: AgentNotifier
    ) {
        super(agent, notifier);
     }

    override async handleOpenRedemptionsForCornerCase(): Promise<void> {
        throw new Error("Mock AgentBot.");
    }
}
