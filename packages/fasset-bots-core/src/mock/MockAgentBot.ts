import { AgentBot } from "../actors/AgentBot";
import { Agent, OwnerAddressPair } from "../fasset/Agent";
import { AgentNotifier } from "../utils/notifier/AgentNotifier";

export class MockAgentBot extends AgentBot {
    constructor(
        public agent: Agent,
        public notifier: AgentNotifier,
        public owner: OwnerAddressPair,
        public ownerUnderlyingAddress: string,
    ) {
        super(agent, notifier, owner, ownerUnderlyingAddress);
    }

    override async handleOpenRedemptionsForCornerCase(): Promise<void> {
        throw new Error("Mock AgentBot.");
    }
}
