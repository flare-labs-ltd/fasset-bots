import { FormattedString } from "../formatting";
import { BNish } from "../helpers";
import { BaseNotifier, BotType, NotifierTransport } from "./BaseNotifier";

export enum AgentNotificationKey {
    // agent status and settings,
    CCB_STARTED = "CCB",
    LIQUIDATION_STARTED = "LIQUIDATION STARTED",
    FULL_LIQUIDATION_STARTED = "FULL LIQUIDATION",
    LIQUIDATION_WAS_PERFORMED = "LIQUIDATION WAS PERFORMED",
    AGENT_DESTROYED = "AGENT DESTROYED",
    AGENT_CREATED = "AGENT CREATED",
    AGENT_SETTING_UPDATE = "AGENT SETTING UPDATE",
    AGENT_SETTING_UPDATE_FAILED = "AGENT SETTING UPDATE FAILED",
    AGENT_ENTER_AVAILABLE = "AGENT ENTERED AVAILABLE",
    AGENT_EXIT_AVAILABLE = "AGENT EXITED AVAILABLE",
    AGENT_EXIT_AVAILABLE_ANNOUNCEMENT = "AGENT ANNOUNCED EXIT AVAILABLE",
    AGENT_ANNOUNCE_DESTROY = "AGENT ANNOUNCE DESTROY",
    SELF_CLOSE = "SELF CLOSE",
    // minting
    MINTING_CORNER_CASE = "MINTING",
    MINTING_NO_PROOF_OBTAINED = "NO PROOF OBTAINED FOR MINTING",
    MINTING_EXECUTED = "MINTING EXECUTED",
    MINTING_DELETED = "MINTING DELETED",
    MINTING_STARTED = "MINTING STARTED",
    MINTING_DEFAULT_STARTED = "MINTING DEFAULT STARTED",
    MINTING_DEFAULT_SUCCESS = "MINTING DEFAULT SUCCESS",
    MINTING_DEFAULT_FAILED = "MINTING DEFAULT FAILED",
    // redemption
    REDEMPTION_CORNER_CASE = "REDEMPTION",
    REDEMPTION_FAILED = "REDEMPTION FAILED",
    REDEMPTION_BLOCKED = "REDEMPTION BLOCKED",
    REDEMPTION_DEFAULTED = "REDEMPTION DEFAULTED",
    REDEMPTION_PERFORMED = "REDEMPTION WAS PERFORMED",
    REDEMPTION_NO_PROOF_OBTAINED = "NO PROOF OBTAINED FOR REDEMPTION",
    REDEMPTION_NO_ADDRESS_VALIDITY_PROOF_OBTAINED = "NO ADDRESS VALIDITY PROOF OBTAINED FOR REDEMPTION",
    REDEMPTION_CONFLICTING_ADDRESS_VALIDITY_PROOF_OBTAINED = "CONFLICTING ADDRESS VALIDITY PROOF OBTAINED FOR REDEMPTION",
    REDEMPTION_STARTED = "REDEMPTION STARTED",
    REDEMPTION_PAID = "REDEMPTION PAID",
    REDEMPTION_PAYMENT_PROOF = "REDEMPTION PAYMENT PROOF REQUESTED",
    // collateral
    AGENT_COLLATERAL_TOP_UP = "AGENT'S COLLATERAL TOP UP",
    POOL_COLLATERAL_TOP_UP = "POOL'S COLLATERAL TOP UP",
    AGENT_COLLATERAL_TOP_UP_FAILED = "AGENT'S COLLATERAL TOP UP FAILED",
    POOL_COLLATERAL_TOP_UP_FAILED = "POOL'S COLLATERAL TOP UP FAILED",
    WITHDRAW_VAULT_COLLATERAL = "VAULT COLLATERAL WITHDRAWAL",
    WITHDRAW_VAULT_COLLATERAL_ANNOUNCEMENT = "VAULT COLLATERAL WITHDRAWAL ANNOUNCEMENT",
    WITHDRAWAL_FAILED = "COLLATERAL WITHDRAWAL FAILED",
    CANCEL_WITHDRAW_VAULT_COLLATERAL_ANNOUNCEMENT = "CANCEL VAULT COLLATERAL WITHDRAWAL ANNOUNCEMENT",
    // underlying
    LOW_AGENT_FREE_UNDERLYING_BALANCE = "LOW FREE UNDERLYING BALANCE",
    LOW_OWNERS_NATIVE_BALANCE = "LOW BALANCE IN OWNER'S ADDRESS",
    LOW_OWNERS_UNDERLYING_BALANCE = "LOW BALANCE IN OWNER'S UNDERLYING ADDRESS",
    CONFIRM_WITHDRAW_UNDERLYING = "CONFIRM UNDERLYING WITHDRAWAL",
    CANCEL_WITHDRAW_UNDERLYING = "CANCEL UNDERLYING WITHDRAWAL ANNOUNCEMENT",
    ACTIVE_WITHDRAWAL = "ACTIVE WITHDRAWAL",
    NO_ACTIVE_WITHDRAWAL = "NO ACTIVE WITHDRAWAL",
    WITHDRAW_UNDERLYING = "UNDERLYING WITHDRAWAL",
    UNDERLYING_PAYMENT_PAID = "UNDERLYING PAYMENT",
    UNDERLYING_PAYMENT_PROOF = " UNDERLYING PAYMENT PROOF REQUESTED",
    UNDERLYING_NO_PROOF_OBTAINED = "NO PROOF OBTAINED FOR UNDERLYING PAYMENT",
    // pool
    BUY_POOL_TOKENS = "BUY POOL TOKENS",
    VAULT_COLLATERAL_DEPOSIT = "VAULT COLLATERAL DEPOSIT",
    WITHDRAW_POOL_FEES = "POOL FEES WITHDRAWAL",
    BALANCE_POOL_FEES = "BALANCE POOL FEES",
    POOL_DELEGATE = "POOL DELEGATION",
    POOL_UNDELEGATE = "POOL UNDELEGATION",
    CANCEL_POOL_TOKEN_ANNOUNCEMENT = "CANCEL POOL TOKEN REDEMPTION ANNOUNCEMENT",
    REDEEM_POOL_TOKEN_ANNOUNCEMENT = "REDEEM POOL TOKENS ANNOUNCEMENT",
    REDEEM_POOL_TOKEN = "POOL TOKENS REDEMPTION",
    // other
    DAILY_TASK_NO_PROOF_OBTAINED = "NO PROOF OBTAINED FOR DAILY TASK",
    UNRESOLVED_EVENT = "EVENT IN DATABASE NOT FOUND ON CHAIN - SKIPPED",
}


export class AgentNotifier extends BaseNotifier<AgentNotificationKey> {
    constructor(address: string, transports: NotifierTransport[]) {
        super(BotType.AGENT, address, transports);
    }

    async sendCCBAlert(timestamp: string) {
        await this.danger(AgentNotificationKey.CCB_STARTED, `Agent ${this.address} is in collateral call band since ${timestamp}.`);
    }

    async sendLiquidationStartAlert(timestamp: string) {
        await this.critical(AgentNotificationKey.LIQUIDATION_STARTED, `Liquidation has started for agent ${this.address} at ${timestamp}.`);
    }

    async sendFullLiquidationAlert(payment1?: string, payment2?: string) {
        if (payment1 && payment2) {
            await this.critical(
                AgentNotificationKey.FULL_LIQUIDATION_STARTED,
                `Agent ${this.address} is in full liquidation due to duplicate payment: ${payment1} and ${payment2}.`
            );
        } else if (payment1) {
            await this.critical(
                AgentNotificationKey.FULL_LIQUIDATION_STARTED,
                `Agent ${this.address} is in full liquidation due to illegal payment: ${payment1}.`
            );
        } else {
            await this.critical(
                AgentNotificationKey.FULL_LIQUIDATION_STARTED,
                `Agent ${this.address} is in full liquidation due to negative underlying free balance.`
            );
        }
    }

    async sendLiquidationWasPerformed(value: string) {
        await this.info(AgentNotificationKey.LIQUIDATION_WAS_PERFORMED, `Liquidation was performed for agent ${this.address} with value of ${value}`);
    }

    async sendRedemptionExpiredInIndexer(requestId: BNish) {
        await this.info(
            AgentNotificationKey.REDEMPTION_CORNER_CASE,
            `Redemption ${requestId} expired in indexer. Redemption will finish without payment for agent ${this.address}.`
        );
    }

    async sendRedemptionFailed(requestId: BNish, txHash: string, redeemer: string, failureReason: string) {
        await this.danger(
            AgentNotificationKey.REDEMPTION_FAILED,
            `Redemption ${requestId} for redeemer ${redeemer} with payment transactionHash ${txHash} failed due to ${failureReason} for agent ${this.address}.`
        );
    }

    async sendRedemptionBlocked(requestId: BNish, txHash: string, redeemer: string) {
        await this.info(
            AgentNotificationKey.REDEMPTION_BLOCKED,
            `Redemption ${requestId} for redeemer ${redeemer} with payment transactionHash ${txHash} was blocked for agent ${this.address}.`
        );
    }

    async sendRedemptionDefaulted(requestId: BNish, redeemer: string) {
        await this.danger(
            AgentNotificationKey.REDEMPTION_DEFAULTED,
            `Redemption ${requestId} for redeemer ${redeemer} was defaulted for agent ${this.address}.`
        );
    }

    async sendRedemptionWasPerformed(requestId: BNish, redeemer: string) {
        await this.info(
            AgentNotificationKey.REDEMPTION_PERFORMED,
            `Redemption ${requestId} for redeemer ${redeemer} was performed for agent ${this.address}.`
        );
    }

    async sendVaultCollateralTopUpAlert(value: FormattedString) {
        await this.info(
            AgentNotificationKey.AGENT_COLLATERAL_TOP_UP,
            `Agent ${this.address} was automatically topped up with collateral ${value} due to price changes.`
        );
    }

    async sendPoolCollateralTopUpAlert(value: FormattedString) {
        await this.info(
            AgentNotificationKey.POOL_COLLATERAL_TOP_UP,
            `Agent ${this.address} POOL was automatically topped up with collateral ${value} due to price changes.`
        );
    }

    async sendVaultCollateralTopUpFailedAlert(value: FormattedString) {
        await this.danger(
            AgentNotificationKey.AGENT_COLLATERAL_TOP_UP_FAILED,
            `Agent ${this.address} could not be automatically topped up with collateral ${value} due to price changes.`
        );
    }

    async sendPoolCollateralTopUpFailedAlert(value: FormattedString) {
        await this.danger(
            AgentNotificationKey.POOL_COLLATERAL_TOP_UP_FAILED,
            `Agent ${this.address} POOL could not be automatically topped up with collateral ${value} due to price changes.`
        );
    }

    async sendLowBalanceOnUnderlyingOwnersAddress(ownerUnderlyingAddress: string, ownerUnderlyingBalance: FormattedString) {
        await this.info(
            AgentNotificationKey.LOW_OWNERS_UNDERLYING_BALANCE,
            `Owner's underlying address ${ownerUnderlyingAddress} has low underlying ${ownerUnderlyingBalance}.`
        );
    }

    async sendLowBalanceOnOwnersAddress(ownerAddress: string, balance: FormattedString) {
        await this.info(AgentNotificationKey.LOW_OWNERS_NATIVE_BALANCE, `Owner ${ownerAddress} has low balance ${balance}.`);
    }

    async sendRedemptionAddressValidationNoProof(requestId: BNish | null, roundId: number, requestData: string, address: string) {
        await this.danger(
            AgentNotificationKey.REDEMPTION_NO_ADDRESS_VALIDITY_PROOF_OBTAINED,
            `Agent ${this.address} cannot obtain proof for address validity for redemption ${requestId} and address ${address} in round ${roundId} with requested data ${requestData}.`
        );
    }

    async sendRedemptionAddressValidationProofConflict(requestId: BNish | null, roundId: number, requestData: string, address: string) {
        await this.danger(
            AgentNotificationKey.REDEMPTION_NO_ADDRESS_VALIDITY_PROOF_OBTAINED,
            `Agent ${this.address} obtain ed conflicting proof for address validity for redemption ${requestId} and address ${address} in round ${roundId} with requested data ${requestData}.`
        );
    }

    async sendMintingNoProofObtained(requestId: BNish | null, roundId: number, requestData: string) {
        await this.danger(
            AgentNotificationKey.MINTING_NO_PROOF_OBTAINED,
            `Agent ${this.address} cannot obtain proof for minting ${requestId} in round ${roundId} with requested data ${requestData}.`
        );
    }

    async sendRedemptionNoProofObtained(requestId: BNish | null, roundId: number, requestData: string) {
        await this.danger(
            AgentNotificationKey.REDEMPTION_NO_PROOF_OBTAINED,
            `Agent ${this.address} cannot obtain proof for redemption ${requestId} in round ${roundId} with requested data ${requestData}.`
        );
    }

    async sendDailyTaskNoProofObtained(minutes: number) {
        await this.danger(
            AgentNotificationKey.DAILY_TASK_NO_PROOF_OBTAINED,
            `Agent ${this.address} cannot obtain proof confirmed block height existence, waiting for more than ${minutes} minutes.`
        );
    }

    async sendAgentDestroyed() {
        await this.info(AgentNotificationKey.AGENT_DESTROYED, `Agent ${this.address} was destroyed.`);
    }

    async sendAgentCreated() {
        await this.info(AgentNotificationKey.AGENT_CREATED, `Agent ${this.address} was created.`);
    }

    async sendWithdrawVaultCollateral(amount: FormattedString) {
        await this.info(AgentNotificationKey.WITHDRAW_VAULT_COLLATERAL, `Agent ${this.address} withdrew ${amount} of vault collateral.`);
    }

    async sendWithdrawVaultCollateralAnnouncement(amount: FormattedString) {
        await this.info(
            AgentNotificationKey.WITHDRAW_VAULT_COLLATERAL_ANNOUNCEMENT,
            `Agent ${this.address} ANNOUNCED withdrawal of ${amount} for vault collateral.`
        );
    }

    async sendCancelVaultCollateralAnnouncement() {
        await this.info(
            AgentNotificationKey.CANCEL_WITHDRAW_VAULT_COLLATERAL_ANNOUNCEMENT,
            `Agent's ${this.address} vault collateral withdrawal announcement was successfully cancelled.`
        );
    }

    async sendRedeemCollateralPoolTokens(amount: FormattedString) {
        await this.info(AgentNotificationKey.REDEEM_POOL_TOKEN, `Agent ${this.address} redeemed of ${amount} pool tokens.`);
    }

    async sendCancelRedeemCollateralPoolTokensAnnouncement() {
        await this.info(
            AgentNotificationKey.CANCEL_POOL_TOKEN_ANNOUNCEMENT,
            `Agent's ${this.address} pool token redemption announcement was successfully cancelled.`
        );
    }

    async sendRedeemCollateralPoolTokensAnnouncement(amount: FormattedString) {
        await this.info(AgentNotificationKey.REDEEM_POOL_TOKEN_ANNOUNCEMENT, `Agent ${this.address} ANNOUNCED redemptions of ${amount} pool tokens.`);
    }

    async sendAgentSettingsUpdate(settingName: string) {
        await this.info(AgentNotificationKey.AGENT_SETTING_UPDATE, `Agent ${this.address} setting ${settingName} was updated.`);
    }

    async sendAgentAnnouncedExitAvailable() {
        await this.info(AgentNotificationKey.AGENT_EXIT_AVAILABLE_ANNOUNCEMENT, `Agent ${this.address} ANNOUNCED exit available list.`);
    }

    async sendAgentExitedAvailable() {
        await this.info(AgentNotificationKey.AGENT_EXIT_AVAILABLE, `Agent ${this.address} exited available list.`);
    }

    async sendAgentEnteredAvailable() {
        await this.info(AgentNotificationKey.AGENT_ENTER_AVAILABLE, `Agent ${this.address} entered available list.`);
    }

    async sendAgentAnnounceDestroy() {
        await this.info(AgentNotificationKey.AGENT_ANNOUNCE_DESTROY, `Agent ${this.address} successfully announced its DESTRUCTION.`);
    }

    async sendConfirmWithdrawUnderlying(type: string) {
        await this.info(AgentNotificationKey.CONFIRM_WITHDRAW_UNDERLYING, `Agent's ${this.address} underlying ${type} payment was successfully confirmed.`);
    }

    async sendCancelWithdrawUnderlying() {
        await this.info(
            AgentNotificationKey.CANCEL_WITHDRAW_UNDERLYING,
            `Agent's ${this.address} underlying withdrawal announcement was successfully cancelled.`
        );
    }

    async sendCollateralPoolTokensRedemption() {
        await this.info(AgentNotificationKey.REDEEM_POOL_TOKEN, `Agent ${this.address} redeemed pool tokens.`);
    }

    async sendBuyCollateralPoolTokens(amount: FormattedString) {
        await this.info(AgentNotificationKey.BUY_POOL_TOKENS, `Agent ${this.address} bought ${amount} worth of pool tokens successfully.`);
    }

    async sendVaultCollateralDeposit(amount: FormattedString) {
        await this.info(AgentNotificationKey.VAULT_COLLATERAL_DEPOSIT, `Deposit of ${amount} vault collateral tokens to agent ${this.address} was successful.`);
    }

    async sendWithdrawPoolFees(amount: FormattedString) {
        await this.info(AgentNotificationKey.WITHDRAW_POOL_FEES, `Agent ${this.address} withdrew pool fees ${amount} successfully.`);
    }

    async sendBalancePoolFees(amount: FormattedString) {
        await this.info(AgentNotificationKey.BALANCE_POOL_FEES, `Agent ${this.address} has pool fees balance ${amount}.`);
    }

    async sendSelfClose() {
        await this.info(AgentNotificationKey.SELF_CLOSE, `Agent ${this.address} self closed successfully.`);
    }

    async sendActiveWithdrawal() {
        await this.info(AgentNotificationKey.ACTIVE_WITHDRAWAL, `Agent ${this.address} already has an active underlying withdrawal announcement.`);
    }

    async sendNoActiveWithdrawal() {
        await this.info(AgentNotificationKey.NO_ACTIVE_WITHDRAWAL, `Agent ${this.address} has NO active underlying withdrawal announcement.`);
    }

    async sendUnderlyingWithdrawalPerformed(txHash: string, paymentReference: string) {
        await this.info(AgentNotificationKey.WITHDRAW_UNDERLYING, `Agent ${this.address} withdrew underlying with transaction ${txHash} and payment reference ${paymentReference}.`);
    }

    async sendMintingExecuted(requestId: BNish) {
        await this.info(AgentNotificationKey.MINTING_EXECUTED, `Minting ${requestId} executed for ${this.address}.`);
    }

    async sendMintingDeleted(requestId: BNish) {
        await this.info(AgentNotificationKey.MINTING_DELETED, `Minting ${requestId} deleted for ${this.address}.`);
    }

    async sendMintingStarted(requestId: BNish) {
        await this.info(AgentNotificationKey.MINTING_STARTED, `Minting ${requestId} started for ${this.address}.`);
    }

    async sendMintingIndexerExpired(requestId: BNish) {
        await this.danger(
            AgentNotificationKey.MINTING_CORNER_CASE,
            `Minting ${requestId} expired in indexer. Unstick minting was executed for agent ${this.address}.`
        );
    }

    async sendMintingNonPaymentProofRequested(requestId: BNish) {
        await this.info(AgentNotificationKey.MINTING_DEFAULT_STARTED,
            `Agent ${this.address} requested non payment proof for minting ${requestId}.`);
    }

    async sendMintingDefaultSuccess(requestId: BNish) {
        await this.info(AgentNotificationKey.MINTING_DEFAULT_SUCCESS,
            `Agent ${this.address} proved non-payment for minting ${requestId} and executed default.`);
    }

    async sendMintingDefaultFailure(requestId: BNish, roundId: number, requestData: string) {
        await this.danger(
            AgentNotificationKey.MINTING_DEFAULT_FAILED,
            `Agent ${this.address} could obtain non-payment proof for minting ${requestId} in round ${roundId} with requested data ${requestData}.`
        );
    }

    async sendMintingPaymentProofRequested(requestId: BNish) {
        await this.info(AgentNotificationKey.MINTING_CORNER_CASE,
            `Agent ${this.address} requested payment proof for minting ${requestId}.`);
    }

    async sendRedemptionStarted(requestId: BNish) {
        await this.info(AgentNotificationKey.REDEMPTION_STARTED, `Redemption ${requestId} started for ${this.address}.`);
    }

    async sendRedemptionPaid(requestId: BNish) {
        await this.info(AgentNotificationKey.REDEMPTION_PAID, `Redemption ${requestId} was paid for ${this.address}.`);
    }

    async sendRedemptionRequestPaymentProof(requestId: BNish) {
        await this.info(AgentNotificationKey.REDEMPTION_PAYMENT_PROOF, `Payment proof for redemption ${requestId} was requested for ${this.address}.`);
    }

    async sendDelegatePoolCollateral(poolAddress: string, recipient: string, bips: FormattedString) {
        await this.info(AgentNotificationKey.POOL_DELEGATE, `Agent ${this.address} delegated ${bips} of pool collateral for pool ${poolAddress} to ${recipient}.`);
    }

    async sendUndelegatePoolCollateral(poolAddress: string) {
        await this.info(AgentNotificationKey.POOL_UNDELEGATE, `Agent ${this.address} undelegated all pool collateral for pool ${poolAddress}.`);
    }

    async sendAgentCannotUpdateSettingExpired(setting: string) {
        await this.danger(
            AgentNotificationKey.AGENT_SETTING_UPDATE_FAILED,
            `Agent ${this.address} could not update setting ${setting}, as it is not valid anymore.`
        );
    }

    async sendAgentCannotWithdrawCollateral(amount: FormattedString, type: string) {
        await this.danger(
            AgentNotificationKey.WITHDRAWAL_FAILED,
            `Agent ${this.address} could not withdrew ${type} collateral of ${amount}.`
        );
    }

    async sendAgentUnderlyingPaymentCreated(txHash: string, type: string) {
        await this.info(AgentNotificationKey.UNDERLYING_PAYMENT_PAID, `Agent ${this.address} send underlying ${type} transaction ${txHash}.`);
    }

    async sendAgentUnderlyingPaymentRequestPaymentProof(txHash: string, type: string) {
        await this.info(AgentNotificationKey.UNDERLYING_PAYMENT_PROOF, `Payment proof for underlying ${type} payment ${txHash} was requested for ${this.address}.`);
    }

    async sendAgentUnderlyingPaymentNoProofObtained(txHash: string, type: string, roundId: number, requestData: string) {
        await this.danger(
            AgentNotificationKey.UNDERLYING_NO_PROOF_OBTAINED,
            `Agent ${this.address} cannot obtain proof for underlying ${type} payment ${txHash} in round ${roundId} with requested data ${requestData}.`
        );
    }

    async sendSettingsUpdateStarted(settingName: string, validAt: string) {
        await this.info(AgentNotificationKey.AGENT_SETTING_UPDATE, `Agent ${this.address} started setting ${settingName} that is valid at ${validAt}.`);
    }
}
