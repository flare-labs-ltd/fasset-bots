import { BaseNotifier, BotType, NotifierTransport } from "./BaseNotifier";

enum LiquidatorNotificationKey {
    AGENT_LIQUIDATED = "AGENT LIQUIDATED",
}

export class LiquidatorNotifier extends BaseNotifier<LiquidatorNotificationKey> {
    constructor(address: string, transports: NotifierTransport[]) {
        super(BotType.LIQUIDATOR, address, transports);
    }

    async sendAgentLiquidated(agentVault: string) {
        await this.info(
            LiquidatorNotificationKey.AGENT_LIQUIDATED,
            `Liquidator ${this.address} liquidated agent ${agentVault}.`
        );
    }
}
