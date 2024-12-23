import { BaseNotifier, BotType, NotifierTransport } from "./BaseNotifier";

enum ChallengerNotificationKey {
    ILLEGAL_TRANSACTION_CHALLENGE = "ILLEGAL TRANSACTION CHALLENGE",
    DOUBLE_PAYMENT_CHALLENGE = "DOUBLE PAYMENT CHALLENGE",
    FREE_BALANCE_NEGATIVE_CHALLENGE = "FREE BALANCE NEGATIVE CHALLENGE",
    UNDERLYING_PAYMENT_CONFIRMED = "UNDERLYING PAYMENT CONFIRMED",
}

export class ChallengerNotifier extends BaseNotifier<ChallengerNotificationKey> {
    constructor(address: string, transports: NotifierTransport[]) {
        super(BotType.CHALLENGER, address, transports);
    }

    async sendIllegalTransactionChallenge(agentVault: string, transactionHash: string) {
        await this.info(
            ChallengerNotificationKey.ILLEGAL_TRANSACTION_CHALLENGE,
            `Challenger ${this.address} successfully challenged agent ${agentVault} for illegal transaction ${transactionHash}.`
        );
    }

    async sendDoublePaymentChallenge(agentVault: string, transactionHash1: string, transactionHash2: string) {
        await this.info(
            ChallengerNotificationKey.DOUBLE_PAYMENT_CHALLENGE,
            `Challenger ${this.address} successfully challenged agent ${agentVault} for double payments for ${transactionHash1} and ${transactionHash2}.`
        );
    }

    async sendFreeBalanceNegative(agentVault: string) {
        await this.info(
            ChallengerNotificationKey.FREE_BALANCE_NEGATIVE_CHALLENGE,
            `Challenger ${this.address} successfully challenged agent ${agentVault} for free negative balance.`
        );
    }

    async sendUnderlyingPaymentConfirmed(agentVault: string, transactionHash: string) {
        await this.info(
            ChallengerNotificationKey.UNDERLYING_PAYMENT_CONFIRMED,
            `Challenger ${this.address} successfully confirmed underlying payment ${transactionHash} for agent ${agentVault}.`
        );
    }
}
