import { MockNotifier } from "../../src/mock/MockNotifier";
import { EventFormatter } from "../test-utils/EventFormatter";

export class FuzzingNotifier extends MockNotifier {
    constructor(
        public notifier: MockNotifier,
        public eventFormatter: EventFormatter
    ) {
        super();
    }

    send(title: string, message?: string) {
        this.notifier.send(title, message);
    }

    async sendCCBAlert(agentVault: string, timestamp: string): Promise<void> {
        this.notifier.sendCCBAlert(this.eventFormatter.formatAddress(agentVault), timestamp);
    }
    async sendLiquidationStartAlert(agentVault: string, timestamp: string): Promise<void> {
        this.notifier.sendLiquidationStartAlert(this.eventFormatter.formatAddress(agentVault), timestamp);
    }
    async sendFullLiquidationAlert(agentVault: string, payment1?: string | undefined, payment2?: string | undefined): Promise<void> {
        this.notifier.sendFullLiquidationAlert(this.eventFormatter.formatAddress(agentVault), payment1, payment2);
    }
    async sendLiquidationWasPerformed(agentVault: string, value: string): Promise<void> {
        this.notifier.sendLiquidationWasPerformed(this.eventFormatter.formatAddress(agentVault), value);
    }
    async sendMintingCornerCase(agentVault: string, requestId: string, indexerExpired: boolean, paymentProof: boolean): Promise<void> {
        this.notifier.sendMintingCornerCase(this.eventFormatter.formatAddress(agentVault), requestId, indexerExpired, paymentProof);
    }
    async sendRedemptionCornerCase(agentVault: string, requestId: string): Promise<void> {
        this.notifier.sendRedemptionCornerCase(this.eventFormatter.formatAddress(agentVault), requestId);
    }
    async sendRedemptionFailedOrBlocked(requestId: string, txHash: string, redeemer: string, agentVault: string, failureReason?: string | undefined): Promise<void> {
        this.notifier.sendRedemptionFailedOrBlocked(requestId, txHash, this.eventFormatter.formatAddress(redeemer), this.eventFormatter.formatAddress(agentVault), failureReason);
    }
    async sendRedemptionDefaulted(requestId: string, redeemer: string, agentVault: string): Promise<void> {
        this.notifier.sendRedemptionDefaulted(requestId, this.eventFormatter.formatAddress(redeemer), this.eventFormatter.formatAddress(agentVault));
    }
    async sendRedemptionWasPerformed(requestId: string, redeemer: string, agentVault: string): Promise<void> {
        this.notifier.sendRedemptionWasPerformed(requestId, this.eventFormatter.formatAddress(redeemer), this.eventFormatter.formatAddress(agentVault));
    }
    async sendCollateralTopUpAlert(agentVault: string, value: string, pool?: boolean): Promise<void> {
        this.notifier.sendCollateralTopUpAlert(this.eventFormatter.formatAddress(agentVault), value, pool);
    }
    async sendCollateralTopUpFailedAlert(agentVault: string, value: string, pool?: boolean): Promise<void> {
        this.notifier.sendCollateralTopUpFailedAlert(this.eventFormatter.formatAddress(agentVault), value, pool);
    }
    async sendLowUnderlyingAgentBalanceFailed(agentVault: string, freeUnderlyingBalanceUBA: string): Promise<void> {
        this.notifier.sendLowUnderlyingAgentBalanceFailed(this.eventFormatter.formatAddress(agentVault), freeUnderlyingBalanceUBA);
    }
    async sendLowUnderlyingAgentBalance(agentVault: string, amount: string): Promise<void> {
        this.notifier.sendLowUnderlyingAgentBalance(this.eventFormatter.formatAddress(agentVault), amount);
    }
    async sendLowBalanceOnUnderlyingOwnersAddress(agentVault: string, ownerUnderlyingAddress: string, ownerUnderlyingBalance: string): Promise<void> {
        this.notifier.sendLowBalanceOnUnderlyingOwnersAddress(this.eventFormatter.formatAddress(agentVault), ownerUnderlyingAddress, ownerUnderlyingBalance);
    }
    async sendLowBalanceOnOwnersAddress(agentVault: string, ownerAddress: string, balance: string, tokenSymbol: string): Promise<void> {
        this.notifier.sendLowBalanceOnOwnersAddress(this.eventFormatter.formatAddress(agentVault), this.eventFormatter.formatAddress(ownerAddress), balance, tokenSymbol);
    }
    async sendNoProofObtained(agentVault: string, requestId: string, roundId: number, requestData: string, redemption?: boolean | undefined): Promise<void> {
        this.notifier.sendNoProofObtained(this.eventFormatter.formatAddress(agentVault), requestId, roundId, requestData, redemption);
    }
    async sendAgentDestroyed(agentVault: string): Promise<void> {
        this.notifier.sendAgentDestroyed(this.eventFormatter.formatAddress(agentVault));
    }
    async sendAgentCreated(agentVault: string): Promise<void> {
        this.notifier.sendAgentCreated(this.eventFormatter.formatAddress(agentVault));
    }
    async sendWithdrawVaultCollateral(agentVault: string, amount: string): Promise<void> {
        this.notifier.sendWithdrawVaultCollateral(this.eventFormatter.formatAddress(agentVault), amount);
    }
    async sendWithdrawVaultCollateralAnnouncement(agentVault: string, amount: string): Promise<void> {
        this.notifier.sendWithdrawVaultCollateralAnnouncement(this.eventFormatter.formatAddress(agentVault), amount);
    }
    async sendRedeemCollateralPoolTokensAnnouncement(agentVault: string, amount: string): Promise<void> {
        this.notifier.sendRedeemCollateralPoolTokensAnnouncement(this.eventFormatter.formatAddress(agentVault), amount);
    }
    async sendAgentSettingsUpdate(agentVault: string, settingName: string): Promise<void> {
        this.notifier.sendAgentSettingsUpdate(this.eventFormatter.formatAddress(agentVault), settingName);
    }
    async sendAgentAnnouncedExitAvailable(agentVault: string): Promise<void> {
        this.notifier.sendAgentAnnouncedExitAvailable(this.eventFormatter.formatAddress(agentVault));
    }
    async sendAgentExitedAvailable(agentVault: string): Promise<void> {
        this.notifier.sendAgentExitedAvailable(this.eventFormatter.formatAddress(agentVault));
    }
    async sendAgentEnteredAvailable(agentVault: string): Promise<void> {
        this.notifier.sendAgentEnteredAvailable(this.eventFormatter.formatAddress(agentVault));
    }
    async sendAgentAnnounceDestroy(agentVault: string): Promise<void> {
        this.notifier.sendAgentAnnounceDestroy(this.eventFormatter.formatAddress(agentVault));
    }
    async sendConfirmWithdrawUnderlying(agentVault: string): Promise<void> {
        this.notifier.sendConfirmWithdrawUnderlying(this.eventFormatter.formatAddress(agentVault));
    }
    async sendCancelWithdrawUnderlying(agentVault: string): Promise<void> {
        this.notifier.sendCancelWithdrawUnderlying(this.eventFormatter.formatAddress(agentVault));
    }
    async sendCollateralPoolTokensRedemption(agentVault: string): Promise<void> {
        this.notifier.sendCollateralPoolTokensRedemption(this.eventFormatter.formatAddress(agentVault));
    }
    async sendBuyCollateralPoolTokens(agentVault: string, amount: string): Promise<void> {
        this.notifier.sendBuyCollateralPoolTokens(this.eventFormatter.formatAddress(agentVault), amount);
    }
    async sendVaultCollateralDeposit(agentVault: string, amount: string): Promise<void> {
        this.notifier.sendVaultCollateralDeposit(this.eventFormatter.formatAddress(agentVault), amount);
    }
    async sendWithdrawPoolFees(agentVault: string, amount: string): Promise<void> {
        this.notifier.sendWithdrawPoolFees(this.eventFormatter.formatAddress(agentVault), amount);
    }
    async sendBalancePoolFees(agentVault: string, amount: string): Promise<void> {
        this.notifier.sendBalancePoolFees(this.eventFormatter.formatAddress(agentVault), amount);
    }
    async sendSelfClose(agentVault: string): Promise<void> {
        this.notifier.sendSelfClose(this.eventFormatter.formatAddress(agentVault));
    }
    async sendActiveWithdrawal(agentVault: string): Promise<void> {
        this.notifier.sendActiveWithdrawal(this.eventFormatter.formatAddress(agentVault));
    }
    async sendNoActiveWithdrawal(agentVault: string): Promise<void> {
        this.notifier.sendNoActiveWithdrawal(this.eventFormatter.formatAddress(agentVault));
    }
    async sendAnnounceUnderlyingWithdrawal(agentVault: string, paymentReference: string): Promise<void> {
        this.notifier.sendAnnounceUnderlyingWithdrawal(this.eventFormatter.formatAddress(agentVault), paymentReference);
    }
    async sendUnderlyingWithdrawalPerformed(agentVault: string, txHash: string): Promise<void> {
        this.notifier.sendUnderlyingWithdrawalPerformed(this.eventFormatter.formatAddress(agentVault), txHash);
    }
    async sendMintingExecuted(agentVault: string, requestId: string): Promise<void> {
        this.notifier.sendMintingExecuted(this.eventFormatter.formatAddress(agentVault), requestId);
    }
    async sendMintingDeleted(agentVault: string, requestId: string): Promise<void> {
        this.notifier.sendMintingDeleted(this.eventFormatter.formatAddress(agentVault), requestId);
    }
    async sendMintingStared(agentVault: string, requestId: string): Promise<void> {
        this.notifier.sendMintingStared(this.eventFormatter.formatAddress(agentVault), requestId);
    }
    async sendRedemptionStarted(agentVault: string, requestId: string): Promise<void> {
        this.notifier.sendRedemptionStarted(this.eventFormatter.formatAddress(agentVault), requestId);
    }
    async sendRedemptionPaid(agentVault: string, requestId: string): Promise<void> {
        this.notifier.sendRedemptionPaid(this.eventFormatter.formatAddress(agentVault), requestId);
    }
    async sendRedemptionRequestPaymentProof(agentVault: string, requestId: string): Promise<void> {
        this.notifier.sendRedemptionRequestPaymentProof(this.eventFormatter.formatAddress(agentVault), requestId);
    }
    async sendDelegatePoolCollateral(agentVault: string, poolCollateral: string, recipient: string, bips: string): Promise<void> {
        this.notifier.sendDelegatePoolCollateral(this.eventFormatter.formatAddress(agentVault), poolCollateral, recipient, bips);
    }
    async sendUndelegatePoolCollateral(agentVault: string, poolCollateral: string): Promise<void> {
        this.sendUndelegatePoolCollateral(this.eventFormatter.formatAddress(agentVault), poolCollateral);
    }
    async sendAgentCannotUpdateSettingExpired(agentVault: string, setting: string): Promise<void> {
        this.notifier.sendAgentCannotUpdateSettingExpired(this.eventFormatter.formatAddress(agentVault), setting);
    }
    async sendRedeemCollateralPoolTokens(agentVault: string, amount: string): Promise<void> {
        this.notifier.sendRedeemCollateralPoolTokens(this.eventFormatter.formatAddress(agentVault), amount);
    }
    async sendAgentCannotWithdrawCollateral(agentVault: string, amount: string, type: string): Promise<void> {
        this.notifier.sendAgentCannotWithdrawCollateral(this.eventFormatter.formatAddress(agentVault), amount, type);
    }
    async sendCancelVaultCollateralAnnouncement(agentVault: string): Promise<void> {
        this.notifier.sendCancelVaultCollateralAnnouncement(this.eventFormatter.formatAddress(agentVault));
    }
    async sendCancelRedeemCollateralPoolTokensAnnouncement(agentVault: string): Promise<void> {
        this.notifier.sendCancelRedeemCollateralPoolTokensAnnouncement(this.eventFormatter.formatAddress(agentVault));
    }
}
