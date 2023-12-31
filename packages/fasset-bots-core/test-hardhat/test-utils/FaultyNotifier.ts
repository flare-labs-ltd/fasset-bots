/* eslint-disable @typescript-eslint/no-unused-vars */
import { Notifier } from "../../src/utils/Notifier";
import MockAdapter from "axios-mock-adapter";

// to use in tests
export class FaultyNotifier extends Notifier {
    mock: MockAdapter | undefined;
    constructor() {
        super("FaultyNotifier")
        if(this.mock && this.client){
            this.mock.onPost('/api/0/bot_alert').reply(500, 'Internal Server Error');
        }
    }

    send(title: string, message?: string | undefined): void {
        throw new Error("Method not implemented.");
    }
    async sendCCBAlert(agentVault: string, timestamp: string): Promise<void> {
        throw new Error("Method not implemented.");
    }
    async sendLiquidationStartAlert(agentVault: string, timestamp: string): Promise<void> {
        throw new Error("Method not implemented.");
    }
    async sendFullLiquidationAlert(agentVault: string, payment1?: string | undefined, payment2?: string | undefined): Promise<void> {
        throw new Error("Method not implemented.");
    }
    async sendLiquidationWasPerformed(agentVault: string, value: string): Promise<void> {
        throw new Error("Method not implemented.");
    }
    async sendMintingCornerCase(agentVault: string, requestId: string, indexerExpired: boolean, paymentProof: boolean): Promise<void> {
        throw new Error("Method not implemented.");
    }
    async sendRedemptionCornerCase(agentVault: string, requestId: string): Promise<void> {
        throw new Error("Method not implemented.");
    }
    async sendRedemptionFailedOrBlocked(requestId: string, txHash: string, redeemer: string, agentVault: string, failureReason?: string | undefined): Promise<void> {
        throw new Error("Method not implemented.");
    }
    async sendRedemptionDefaulted(requestId: string, redeemer: string, agentVault: string): Promise<void> {
        throw new Error("Method not implemented.");
    }
    async sendRedemptionWasPerformed(requestId: string, redeemer: string, agentVault: string): Promise<void> {
        throw new Error("Method not implemented.");
    }
    async sendCollateralTopUpAlert(agentVault: string, value: string, pool?: boolean): Promise<void> {
        throw new Error("Method not implemented.");
    }
    async sendCollateralTopUpFailedAlert(agentVault: string, value: string, pool?: boolean): Promise<void> {
        throw new Error("Method not implemented.");
    }
    async sendLowUnderlyingAgentBalanceFailed(agentVault: string, freeUnderlyingBalanceUBA: string): Promise<void> {
        throw new Error("Method not implemented.");
    }
    async sendLowUnderlyingAgentBalance(agentVault: string, amount: string): Promise<void> {
        throw new Error("Method not implemented.");
    }
    async sendLowBalanceOnUnderlyingOwnersAddress(agentVault: string, ownerUnderlyingAddress: string, ownerUnderlyingBalance: string): Promise<void> {
        throw new Error("Method not implemented.");
    }
    async sendLowBalanceOnOwnersAddress(agentVault: string, ownerAddress: string, balance: string, tokenSymbol: string): Promise<void> {
        throw new Error("Method not implemented.");
    }
    async sendNoProofObtained(agentVault: string, requestId: string, roundId: number, requestData: string, redemption?: boolean | undefined): Promise<void> {
        throw new Error("Method not implemented.");
    }
    async sendAgentDestroyed(agentVault: string): Promise<void> {
        throw new Error("Method not implemented.");
    }
    async sendAgentCreated(agentVault: string): Promise<void> {
        throw new Error("Method not implemented.");
    }
    async sendWithdrawVaultCollateral(agentVault: string, amount: string): Promise<void> {
        throw new Error("Method not implemented.");
    }
    async sendWithdrawVaultCollateralAnnouncement(agentVault: string, amount: string): Promise<void> {
        throw new Error("Method not implemented.");
    }
    async sendRedeemCollateralPoolTokensAnnouncement(agentVault: string, amount: string): Promise<void>  {
        throw new Error("Method not implemented.");
    }
    async sendAgentSettingsUpdate(agentVault: string, settingName: string): Promise<void>  {
        throw new Error("Method not implemented.");
    }
    async sendAgentAnnouncedExitAvailable(agentVault: string): Promise<void> {
        throw new Error("Method not implemented.");
    }
    async sendAgentExitedAvailable(agentVault: string): Promise<void> {
        throw new Error("Method not implemented.");
    }
    async sendAgentEnteredAvailable(agentVault: string): Promise<void> {
        throw new Error("Method not implemented.");
    }
    async sendAgentAnnounceDestroy(agentVault: string): Promise<void> {
        throw new Error("Method not implemented.");
    }
    async sendConfirmWithdrawUnderlying(agentVault: string): Promise<void> {
        throw new Error("Method not implemented.");
    }
    async sendCancelWithdrawUnderlying(agentVault: string): Promise<void> {
        throw new Error("Method not implemented.");
    }
    async sendCollateralPoolTokensRedemption(agentVault: string): Promise<void> {
        throw new Error("Method not implemented.");
    }
    async sendBuyCollateralPoolTokens(agentVault: string, amount: string): Promise<void> {
        throw new Error("Method not implemented.");
    }
    async sendVaultCollateralDeposit(agentVault: string, amount: string): Promise<void> {
        throw new Error("Method not implemented.");
    }
    async sendWithdrawPoolFees(agentVault: string, amount: string): Promise<void> {
        throw new Error("Method not implemented.");
    }
    async sendBalancePoolFees(agentVault: string, amount: string): Promise<void> {
        throw new Error("Method not implemented.");
    }
    async sendSelfClose(agentVault: string): Promise<void> {
        throw new Error("Method not implemented.");
    }
    async sendActiveWithdrawal(agentVault: string): Promise<void> {
        throw new Error("Method not implemented.");
    }
    async sendNoActiveWithdrawal(agentVault: string): Promise<void> {
        throw new Error("Method not implemented.");
    }
    async sendAnnounceUnderlyingWithdrawal(agentVault: string, paymentReference: string): Promise<void> {
        throw new Error("Method not implemented.");
    }
    async sendUnderlyingWithdrawalPerformed(agentVault: string, txHash: string): Promise<void> {
        throw new Error("Method not implemented.");
    }
    async sendMintingExecuted(agentVault: string, requestId: string): Promise<void> {
        throw new Error("Method not implemented.");
    }
    async sendMintingDeleted(agentVault: string, requestId: string): Promise<void> {
        throw new Error("Method not implemented.");
    }
    async sendMintingStared(agentVault: string, requestId: string): Promise<void> {
        throw new Error("Method not implemented.");
    }
    async sendRedemptionStarted(agentVault: string, requestId: string): Promise<void> {
        throw new Error("Method not implemented.");
    }
    async sendRedemptionPaid(agentVault: string, requestId: string): Promise<void> {
        throw new Error("Method not implemented.");
    }
    async sendRedemptionRequestPaymentProof(agentVault: string, requestId: string): Promise<void> {
        throw new Error("Method not implemented.");
    }
    async sendDelegatePoolCollateral(agentVault: string, poolCollateral: string, recipient: string, bips: string): Promise<void> {
        throw new Error("Method not implemented.");
    }
    async sendUndelegatePoolCollateral(agentVault: string, poolCollateral: string): Promise<void> {
        throw new Error("Method not implemented.");
    }
    async sendAgentCannotUpdateSettingExpired(agentVault: string, setting: string): Promise<void> {
        throw new Error("Method not implemented.");
    }
    async sendIllegalTransactionChallenge(challenger: string, agentVault: string, transactionHash: string): Promise<void> {
        throw new Error("Method not implemented.");
    }
    async sendDoublePaymentChallenge(challenger: string, agentVault: string, transactionHash1: string, transactionHash2: string): Promise<void> {
        throw new Error("Method not implemented.");
    }
    async sendFreeBalanceNegative(challenger: string, agentVault: string): Promise<void> {
        throw new Error("Method not implemented.");
    }
    async sendAgentLiquidated(liquidator: string, agentVault: string): Promise<void> {
        throw new Error("Method not implemented.");
    }
    async sendCancelVaultCollateralAnnouncement(agentVault: string): Promise<void> {
        throw new Error("Method not implemented.");
    }
    async sendCancelRedeemCollateralPoolTokensAnnouncement(agentVault: string): Promise<void> {
        throw new Error("Method not implemented.");
    }
    async sendRedeemCollateralPoolTokens(agentVault: string, amount: string): Promise<void> {
        throw new Error("Method not implemented.");
    }
    async sendAgentCannotWithdrawCollateral(agentVault: string, amount: string, type: string): Promise<void> {
        throw new Error("Method not implemented.");
    }
}
