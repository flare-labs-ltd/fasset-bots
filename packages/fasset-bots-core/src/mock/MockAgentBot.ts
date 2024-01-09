import { AgentBot } from "../actors/AgentBot";
import { Agent } from "../fasset/Agent";
import { Notifier } from "../utils/Notifier";

export class MockAgentBot extends AgentBot {
    constructor(
        public agent: Agent,
        public notifier: Notifier
    ) {
        super(agent, notifier);
     }

    override async handleOpenRedemptionsForCornerCase(): Promise<void> {
        throw new Error("Mock AgentBot.");
    }
}