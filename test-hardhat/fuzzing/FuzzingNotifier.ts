import { Notifier } from "../../src/utils/Notifier";
import { EventFormatter } from "../test-utils/EventFormatter";

export class FuzzingNotifier {
    constructor(
        public notifier: Notifier,
        public eventFormatter: EventFormatter
    ) {}

    send(title: string, message?: string) {
        this.notifier.send(title, message);
    }

    sendCCBAlert(agentVault: string, timestamp: string): void {
        this.notifier.sendCCBAlert(this.eventFormatter.formatAddress(agentVault), timestamp);
    }
    sendLiquidationStartAlert(agentVault: string, timestamp: string): void {
        this.notifier.sendLiquidationStartAlert(this.eventFormatter.formatAddress(agentVault), timestamp);
    }
    sendFullLiquidationAlert(agentVault: string, payment1?: string | undefined, payment2?: string | undefined): void {
        this.notifier.sendFullLiquidationAlert(this.eventFormatter.formatAddress(agentVault), payment1, payment2);
    }
    sendLiquidationWasPerformed(agentVault: string, value: string): void {
        this.notifier.sendLiquidationWasPerformed(this.eventFormatter.formatAddress(agentVault), value);
    }
    sendMintingCornerCase(requestId: string, indexerExpired: boolean, paymentProof: boolean): void {
        this.notifier.sendMintingCornerCase(requestId, indexerExpired, paymentProof);
    }
    sendRedemptionCornerCase(requestId: string, agentVault: string): void {
        this.notifier.sendRedemptionCornerCase(requestId, this.eventFormatter.formatAddress(agentVault));
    }
    sendRedemptionFailedOrBlocked(requestId: string, txHash: string, redeemer: string, agentVault: string, failureReason?: string | undefined): void {
        this.notifier.sendRedemptionFailedOrBlocked(
            requestId,
            txHash,
            this.eventFormatter.formatAddress(redeemer),
            this.eventFormatter.formatAddress(agentVault),
            failureReason
        );
    }
    sendRedemptionDefaulted(requestId: string, redeemer: string, agentVault: string): void {
        this.notifier.sendRedemptionDefaulted(requestId, this.eventFormatter.formatAddress(redeemer), this.eventFormatter.formatAddress(agentVault));
    }
    sendRedemptionWasPerformed(requestId: string, redeemer: string, agentVault: string): void {
        this.notifier.sendRedemptionWasPerformed(requestId, this.eventFormatter.formatAddress(redeemer), this.eventFormatter.formatAddress(agentVault));
    }
    sendCollateralTopUpAlert(agentVault: string, value: string, pool?: boolean): void {
        this.notifier.sendCollateralTopUpAlert(this.eventFormatter.formatAddress(agentVault), value, pool);
    }
    sendCollateralTopUpFailedAlert(agentVault: string, value: string, pool?: boolean): void {
        this.notifier.sendCollateralTopUpFailedAlert(this.eventFormatter.formatAddress(agentVault), value, pool);
    }
    sendLowUnderlyingAgentBalanceFailed(agentVault: string, freeUnderlyingBalanceUBA: string): void {
        this.notifier.sendLowUnderlyingAgentBalanceFailed(this.eventFormatter.formatAddress(agentVault), freeUnderlyingBalanceUBA);
    }
    sendLowUnderlyingAgentBalance(agentVault: string, amount: string): void {
        this.notifier.sendLowUnderlyingAgentBalance(this.eventFormatter.formatAddress(agentVault), amount);
    }
    sendLowBalanceOnUnderlyingOwnersAddress(ownerUnderlyingAddress: string, ownerUnderlyingBalance: string): void {
        this.notifier.sendLowBalanceOnUnderlyingOwnersAddress(ownerUnderlyingAddress, ownerUnderlyingBalance);
    }
    sendLowBalanceOnOwnersAddress(ownerAddress: string, balance: string, tokenSymbol: string): void {
        this.notifier.sendLowBalanceOnOwnersAddress(this.eventFormatter.formatAddress(ownerAddress), balance, tokenSymbol);
    }
    sendNoProofObtained(agentVault: string, requestId: string, roundId: number, requestData: string, redemption?: boolean | undefined): void {
        this.notifier.sendNoProofObtained(this.eventFormatter.formatAddress(agentVault), requestId, roundId, requestData, redemption);
    }
    sendAgentDestroyed(agentVault: string): void {
        this.notifier.sendAgentDestroyed(this.eventFormatter.formatAddress(agentVault));
    }
    sendAgentCreated(agentVault: string) {
        this.notifier.sendAgentCreated(this.eventFormatter.formatAddress(agentVault));
    }
    sendWithdrawVaultCollateral(agentVault: string, amount: string): void {
        this.notifier.sendWithdrawVaultCollateral(this.eventFormatter.formatAddress(agentVault), amount);
    }
    sendWithdrawVaultCollateralAnnouncement(agentVault: string, amount: string) {
        this.notifier.sendWithdrawVaultCollateralAnnouncement(this.eventFormatter.formatAddress(agentVault), amount);
    }
    sendAgentSettingsUpdate(agentVault: string, settingName: string): void {
        this.notifier.sendAgentSettingsUpdate(this.eventFormatter.formatAddress(agentVault), settingName);
    }
    sendAgentAnnouncedExitAvailable(agentVault: string) {
        this.notifier.sendAgentAnnouncedExitAvailable(this.eventFormatter.formatAddress(agentVault));
    }
    sendAgentExitedAvailable(agentVault: string): void {
        this.notifier.sendAgentExitedAvailable(this.eventFormatter.formatAddress(agentVault));
    }
    sendAgentEnteredAvailable(agentVault: string) {
        this.notifier.sendAgentEnteredAvailable(this.eventFormatter.formatAddress(agentVault));
    }
    sendAgentAnnounceDestroy(agentVault: string): void {
        this.notifier.sendAgentAnnounceDestroy(this.eventFormatter.formatAddress(agentVault));
    }
    sendConfirmWithdrawUnderlying(agentVault: string): void {
        this.notifier.sendConfirmWithdrawUnderlying(this.eventFormatter.formatAddress(agentVault));
    }
    sendCancelWithdrawUnderlying(agentVault: string): void {
        this.notifier.sendCancelWithdrawUnderlying(this.eventFormatter.formatAddress(agentVault));
    }
    sendCollateralPoolTokensRedemption(agentVault: string): void {
        this.notifier.sendCollateralPoolTokensRedemption(this.eventFormatter.formatAddress(agentVault));
    }
    sendBuyCollateralPoolTokens(agentVault: string, amount: string) {
        this.notifier.sendBuyCollateralPoolTokens(this.eventFormatter.formatAddress(agentVault), amount);
    }
    sendVaultCollateralDeposit(agentVault: string, amount: string) {
        this.notifier.sendVaultCollateralDeposit(this.eventFormatter.formatAddress(agentVault), amount);
    }
    sendWithdrawPoolFees(agentVault: string, amount: string) {
        this.notifier.sendWithdrawPoolFees(this.eventFormatter.formatAddress(agentVault), amount);
    }
    sendBalancePoolFees(agentVault: string, amount: string) {
        this.notifier.sendBalancePoolFees(this.eventFormatter.formatAddress(agentVault), amount);
    }
    sendSelfClose(agentVault: string) {
        this.notifier.sendSelfClose(this.eventFormatter.formatAddress(agentVault));
    }
    sendActiveWithdrawal(agentVault: string) {
        this.notifier.sendActiveWithdrawal(this.eventFormatter.formatAddress(agentVault));
    }
    sendNoActiveWithdrawal(agentVault: string) {
        this.notifier.sendNoActiveWithdrawal(this.eventFormatter.formatAddress(agentVault));
    }
    sendAnnounceUnderlyingWithdrawal(agentVault: string, paymentReference: string) {
        this.notifier.sendAnnounceUnderlyingWithdrawal(this.eventFormatter.formatAddress(agentVault), paymentReference);
    }
    sendUnderlyingWithdrawalPerformed(agentVault: string, txHash: string) {
        this.notifier.sendUnderlyingWithdrawalPerformed(this.eventFormatter.formatAddress(agentVault), txHash);
    }
    sendMintingExecuted(agentVault: string, requestId: string) {
        this.notifier.sendMintingExecuted(this.eventFormatter.formatAddress(agentVault), requestId);
    }
    sendMintingDeleted(agentVault: string, requestId: string) {
        this.notifier.sendMintingDeleted(this.eventFormatter.formatAddress(agentVault), requestId);
    }
    sendMintingStared(agentVault: string, requestId: string) {
        this.notifier.sendMintingStared(this.eventFormatter.formatAddress(agentVault), requestId);
    }
    sendRedemptionStarted(agentVault: string, requestId: string) {
        this.notifier.sendRedemptionStarted(this.eventFormatter.formatAddress(agentVault), requestId);
    }
    sendRedemptionPaid(agentVault: string, requestId: string) {
        this.notifier.sendRedemptionPaid(this.eventFormatter.formatAddress(agentVault), requestId);
    }
    sendRedemptionRequestPaymentProof(agentVault: string, requestId: string) {
        this.notifier.sendRedemptionRequestPaymentProof(this.eventFormatter.formatAddress(agentVault), requestId);
    }
    sendDelegatePoolCollateral(agentVault: string, poolCollateral: string, recipient: string, bips: string) {
        this.notifier.sendDelegatePoolCollateral(this.eventFormatter.formatAddress(agentVault), poolCollateral, recipient, bips);
    }
    sendUndelegatePoolCollateral(agentVault: string, poolCollateral: string) {
        this.sendUndelegatePoolCollateral(this.eventFormatter.formatAddress(agentVault), poolCollateral);
    }
}
