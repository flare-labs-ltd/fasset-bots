import { AgentBot } from "../actors/AgentBot";
import { AgentB } from "../fasset-bots/AgentB";
import { Notifier } from "../utils/Notifier";

export class MockAgentBot extends AgentBot {
    constructor(
        public agent: AgentB,
        public notifier: Notifier
    ) {
        super(agent, notifier);
     }

    override async handleOpenRedemptionsForCornerCase(): Promise<void> {
        throw new Error("Mock AgentBot.");
    }
}