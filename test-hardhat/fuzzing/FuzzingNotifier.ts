import { Notifier } from "../../src/utils/Notifier";
import { EventFormatter } from "../test-utils/EventFormatter";

export class FuzzingNotifier {

    constructor(
        public notifier: Notifier,
        public eventFormatter: EventFormatter
    ) { }

    send(title: string, message?: string) {
        this.notifier.send(title, message);
    }

    sendCCBAlert(agentVault: string, timestamp: string): void {
        this.notifier.sendCCBAlert(this.eventFormatter.formatAddress(agentVault), timestamp);
    }
    sendLiquidationStartAlert(agentVault: string, timestamp: string): void {
        this.notifier.sendLiquidationStartAlert(this.eventFormatter.formatAddress(agentVault), timestamp);
    }
    sendFullLiquidationAlert(agentVault: string, timestamp: string, payment1?: string | undefined, payment2?: string | undefined): void {
        this.notifier.sendFullLiquidationAlert(this.eventFormatter.formatAddress(agentVault), timestamp, payment1, payment2);
    }
    sendLiquidationWasPerformed(agentVault: string, value: string): void {
        this.notifier.sendLiquidationWasPerformed(this.eventFormatter.formatAddress(agentVault), value);
    }
    sendMintingCornerCase(requestId: string, indexerExpired?: boolean): void {
        this.notifier.sendMintingCornerCase(requestId, indexerExpired);
    }
    sendRedemptionCornerCase(requestId: string, agentVault: string): void {
        this.notifier.sendRedemptionCornerCase(requestId, this.eventFormatter.formatAddress(agentVault));
    }
    sendRedemptionFailedOrBlocked(requestId: string, txHash: string, redeemer: string, agentVault: string, failureReason?: string | undefined): void {
        this.notifier.sendRedemptionFailedOrBlocked(requestId, txHash, this.eventFormatter.formatAddress(redeemer), this.eventFormatter.formatAddress(agentVault), failureReason);
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
    sendWithdrawClass1(agentVault: string, amount: string): void {
        this.notifier.sendWithdrawClass1(this.eventFormatter.formatAddress(agentVault), amount);
    }
    sendAgentSettingsUpdate(agentVault: string, settingName: string): void {
        this.notifier.sendAgentSettingsUpdate(this.eventFormatter.formatAddress(agentVault), settingName);
    }
    sendAgentExitedAvailable(agentVault: string): void {
        this.notifier.sendAgentExitedAvailable(this.eventFormatter.formatAddress(agentVault));
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


}