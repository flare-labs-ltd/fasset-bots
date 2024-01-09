/* eslint-disable @typescript-eslint/no-unused-vars */
import { Notifier } from "../../src/utils/Notifier";

// to use in tests
export class FaultyNotifier implements Notifier {
    sendCancelVaultCollateralAnnouncement(agentVault: string): void {
        throw new Error("Method not implemented.");
    }
    sendCancelRedeemCollateralPoolTokensAnnouncement(agentVault: string): void {
        throw new Error("Method not implemented.");
    }
    sendRedeemCollateralPoolTokens(agentVault: string, amount: string): void {
        throw new Error("Method not implemented.");
    }
    sendAgentCannotWithdrawCollateral(agentVault: string, amount: string, type: string): void {
        throw new Error("Method not implemented.");
    }
    send(title: string, message?: string | undefined): void {
        throw new Error("Method not implemented.");
    }
    sendCCBAlert(agentVault: string, timestamp: string): void {
        throw new Error("Method not implemented.");
    }
    sendLiquidationStartAlert(agentVault: string, timestamp: string): void {
        throw new Error("Method not implemented.");
    }
    sendFullLiquidationAlert(agentVault: string, payment1?: string | undefined, payment2?: string | undefined): void {
        throw new Error("Method not implemented.");
    }
    sendLiquidationWasPerformed(agentVault: string, value: string): void {
        throw new Error("Method not implemented.");
    }
    sendMintingCornerCase(requestId: string, indexerExpired: boolean, paymentProof: boolean): void {
        throw new Error("Method not implemented.");
    }
    sendRedemptionCornerCase(requestId: string, agentVault: string): void {
        throw new Error("Method not implemented.");
    }
    sendRedemptionFailedOrBlocked(requestId: string, txHash: string, redeemer: string, agentVault: string, failureReason?: string | undefined): void {
        throw new Error("Method not implemented.");
    }
    sendRedemptionDefaulted(requestId: string, redeemer: string, agentVault: string): void {
        throw new Error("Method not implemented.");
    }
    sendRedemptionWasPerformed(requestId: string, redeemer: string, agentVault: string): void {
        throw new Error("Method not implemented.");
    }
    sendCollateralTopUpAlert(agentVault: string, value: string, pool?: boolean): void {
        throw new Error("Method not implemented.");
    }
    sendCollateralTopUpFailedAlert(agentVault: string, value: string, pool?: boolean): void {
        throw new Error("Method not implemented.");
    }
    sendLowUnderlyingAgentBalanceFailed(agentVault: string, freeUnderlyingBalanceUBA: string): void {
        throw new Error("Method not implemented.");
    }
    sendLowUnderlyingAgentBalance(agentVault: string, amount: string): void {
        throw new Error("Method not implemented.");
    }
    sendLowBalanceOnUnderlyingOwnersAddress(ownerUnderlyingAddress: string, ownerUnderlyingBalance: string): void {
        throw new Error("Method not implemented.");
    }
    sendLowBalanceOnOwnersAddress(ownerAddress: string, balance: string, tokenSymbol: string): void {
        throw new Error("Method not implemented.");
    }
    sendNoProofObtained(agentVault: string, requestId: string, roundId: number, requestData: string, redemption?: boolean | undefined): void {
        throw new Error("Method not implemented.");
    }
    sendAgentDestroyed(agentVault: string): void {
        throw new Error("Method not implemented.");
    }
    sendAgentCreated(agentVault: string): void {
        throw new Error("Method not implemented.");
    }
    sendWithdrawVaultCollateral(agentVault: string, amount: string): void {
        throw new Error("Method not implemented.");
    }
    sendWithdrawVaultCollateralAnnouncement(agentVault: string, amount: string): void {
        throw new Error("Method not implemented.");
    }
    sendRedeemCollateralPoolTokensAnnouncement(agentVault: string, amount: string) {
        throw new Error("Method not implemented.");
    }
    sendAgentSettingsUpdate(agentVault: string, settingName: string): void {
        throw new Error("Method not implemented.");
    }
    sendAgentAnnouncedExitAvailable(agentVault: string): void {
        throw new Error("Method not implemented.");
    }
    sendAgentExitedAvailable(agentVault: string): void {
        throw new Error("Method not implemented.");
    }
    sendAgentEnteredAvailable(agentVault: string): void {
        throw new Error("Method not implemented.");
    }
    sendAgentAnnounceDestroy(agentVault: string): void {
        throw new Error("Method not implemented.");
    }
    sendConfirmWithdrawUnderlying(agentVault: string): void {
        throw new Error("Method not implemented.");
    }
    sendCancelWithdrawUnderlying(agentVault: string): void {
        throw new Error("Method not implemented.");
    }
    sendCollateralPoolTokensRedemption(agentVault: string): void {
        throw new Error("Method not implemented.");
    }
    sendBuyCollateralPoolTokens(agentVault: string, amount: string): void {
        throw new Error("Method not implemented.");
    }
    sendVaultCollateralDeposit(agentVault: string, amount: string): void {
        throw new Error("Method not implemented.");
    }
    sendWithdrawPoolFees(agentVault: string, amount: string): void {
        throw new Error("Method not implemented.");
    }
    sendBalancePoolFees(agentVault: string, amount: string): void {
        throw new Error("Method not implemented.");
    }
    sendSelfClose(agentVault: string): void {
        throw new Error("Method not implemented.");
    }
    sendActiveWithdrawal(agentVault: string): void {
        throw new Error("Method not implemented.");
    }
    sendNoActiveWithdrawal(agentVault: string): void {
        throw new Error("Method not implemented.");
    }
    sendAnnounceUnderlyingWithdrawal(agentVault: string, paymentReference: string): void {
        throw new Error("Method not implemented.");
    }
    sendUnderlyingWithdrawalPerformed(agentVault: string, txHash: string): void {
        throw new Error("Method not implemented.");
    }
    sendMintingExecuted(agentVault: string, requestId: string): void {
        throw new Error("Method not implemented.");
    }
    sendMintingDeleted(agentVault: string, requestId: string): void {
        throw new Error("Method not implemented.");
    }
    sendMintingStared(agentVault: string, requestId: string): void {
        throw new Error("Method not implemented.");
    }
    sendRedemptionStarted(agentVault: string, requestId: string): void {
        throw new Error("Method not implemented.");
    }
    sendRedemptionPaid(agentVault: string, requestId: string): void {
        throw new Error("Method not implemented.");
    }
    sendRedemptionRequestPaymentProof(agentVault: string, requestId: string): void {
        throw new Error("Method not implemented.");
    }
    sendDelegatePoolCollateral(agentVault: string, poolCollateral: string, recipient: string, bips: string) {
        throw new Error("Method not implemented.");
    }
    sendUndelegatePoolCollateral(agentVault: string, poolCollateral: string) {
        throw new Error("Method not implemented.");
    }
    sendAgentCannotUpdateSettingExpired(agentVault: string, setting: string) {
        throw new Error("Method not implemented.");
    }
}
