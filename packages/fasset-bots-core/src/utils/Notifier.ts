import chalk from "chalk";
// agent status and settings
const CCB_TITLE = "CCB";
const LIQUIDATION_STARTED = "LIQUIDATION STARTED";
const FULL_LIQUIDATION_TITLE = "FULL LIQUIDATION";
const LIQUIDATION_WAS_PERFORMED = "LIQUIDATION WAS PERFORMED";
const AGENT_DESTROYED = "AGENT DESTROYED";
const AGENT_CREATED = "AGENT CREATED";
const AGENT_SETTING_UPDATE = "AGENT SETTING UPDATE";
const AGENT_SETTING_UPDATE_FAILED = "AGENT SETTING UPDATE FAILED";
const AGENT_ENTER_AVAILABLE = "AGENT ENTERED AVAILABLE";
const AGENT_EXIT_AVAILABLE = "AGENT EXITED AVAILABLE";
const AGENT_EXIT_AVAILABLE_ANNOUNCEMENT = "AGENT ANNOUNCED EXIT AVAILABLE";
const AGENT_ANNOUNCE_DESTROY = "AGENT ANNOUNCE DESTROY";
const SELF_CLOSE = "SELF CLOSE";

// minting
const MINTING_CORNER_CASE = "MINTING";
const MINTING_NO_PROOF_OBTAINED = "NO PROOF OBTAINED FOR MINTING";
const MINTING_EXECUTED = "MINTING EXECUTED";
const MINTING_DELETED = "MINTING DELETED";
const MINTING_STARTED = "MINTING STARTED";

// redemption
const REDEMPTION_CORNER_CASE = "REDEMPTION";
const REDEMPTION_FAILED_BLOCKED = "REDEMPTION FAILED OR BLOCKED";
const REDEMPTION_DEFAULTED = "REDEMPTION DEFAULTED";
const REDEMPTION_PERFORMED = "REDEMPTION WAS PERFORMED";
const REDEMPTION_NO_PROOF_OBTAINED = "NO PROOF OBTAINED FOR REDEMPTION";
const REDEMPTION_STARTED = "REDEMPTION STARTED";
const REDEMPTION_PAID = "REDEMPTION PAID";
const REDEMPTION_PAYMENT_PROOF = "REDEMPTION PAYMENT PROOF REQUESTED";

// collateral
const AGENT_COLLATERAL_TOP_UP = "AGENT'S COLLATERAL TOP UP";
const POOL_COLLATERAL_TOP_UP = "POOL'S COLLATERAL TOP UP";
const AGENT_COLLATERAL_TOP_UP_FAILED = "AGENT'S COLLATERAL TOP UP FAILED";
const POOL_COLLATERAL_TOP_UP_FAILED = "POOL'S COLLATERAL TOP UP FAILED";
const WITHDRAW_VAULT_COLLATERAL = "VAULT COLLATERAL WITHDRAWAL";
const WITHDRAW_VAULT_COLLATERAL_ANNOUNCEMENT = "VAULT COLLATERAL WITHDRAWAL ANNOUNCEMENT";
const WITHDRAWAL_FAILED = "COLLATERAL WITHDRAWAL FAILED";
const CANCEL_WITHDRAW_VAULT_COLLATERAL_ANNOUNCEMENT = "CANCEL VAULT COLLATERAL WITHDRAWAL ANNOUNCEMENT";

// underlying
const LOW_AGENT_FREE_UNDERLYING_BALANCE = "LOW FREE UNDERLYING BALANCE";
const LOW_OWNERS_NATIVE_BALANCE = "LOW BALANCE IN OWNER'S ADDRESS";
const LOW_OWNERS_UNDERLYING_BALANCE = "LOW BALANCE IN OWNER'S UNDERLYING ADDRESS";
const CONFIRM_WITHDRAW_UNDERLYING = "CONFIRM UNDERLYING WITHDRAWAL ANNOUNCEMENT";
const CANCEL_WITHDRAW_UNDERLYING = "CANCEL UNDERLYING WITHDRAWAL ANNOUNCEMENT";
const ACTIVE_WITHDRAWAL = "ACTIVE WITHDRAWAL";
const NO_ACTIVE_WITHDRAWAL = "NO ACTIVE WITHDRAWAL";
const ANNOUNCE_WITHDRAW_UNDERLYING = "ANNOUNCE UNDERLYING WITHDRAWAL";
const WITHDRAW_UNDERLYING = "UNDERLYING WITHDRAWAL";

// pool
const BUY_POOL_TOKENS = "BUY POOL TOKENS";
const VAULT_COLLATERAL_DEPOSIT = "VAULT COLLATERAL DEPOSIT";
const WITHDRAW_POOL_FEES = "POOL FEES WITHDRAWAL";
const BALANCE_POOL_FEES = "BALANCE POOL FEES";
const POOL_DELEGATE = "POOL DELEGATION";
const POOL_UNDELEGATE = "POOL UNDELEGATION";
const CANCEL_POOL_TOKEN_ANNOUNCEMENT = "CANCEL POOL TOKEN REDEMPTION ANNOUNCEMENT";
const REDEEM_POOL_TOKEN_ANNOUNCEMENT = "REDEEM POOL TOKENS ANNOUNCEMENT";
const REDEEM_POOL_TOKEN = "POOL TOKENS REDEMPTION";

// other
const DAILY_TASK_NO_PROOF_OBTAINED = "NO PROOF OBTAINED FOR DAILY TASK";

export class Notifier {
    send(title: string, message?: string) {
        if (message) {
            console.log(chalk.cyan(title + ":") + " " + message);
        } else {
            console.log(chalk.cyan(title));
        }
    }

    sendCCBAlert(agentVault: string, timestamp: string) {
        this.send(CCB_TITLE, `Agent ${agentVault} is in collateral call band since ${timestamp}.`);
    }

    sendLiquidationStartAlert(agentVault: string, timestamp: string) {
        this.send(LIQUIDATION_STARTED, `Liquidation has started for agent ${agentVault} at ${timestamp}.`);
    }

    sendFullLiquidationAlert(agentVault: string, payment1?: string, payment2?: string) {
        if (payment1 && payment2) {
            this.send(FULL_LIQUIDATION_TITLE, `Agent ${agentVault} is in full liquidation due to duplicate payment: ${payment1} and ${payment2}.`);
        } else if (payment1) {
            this.send(FULL_LIQUIDATION_TITLE, `Agent ${agentVault} is in full liquidation due to illegal payment: ${payment1}.`);
        } else {
            this.send(FULL_LIQUIDATION_TITLE, `Agent ${agentVault} is in full liquidation due to negative underlying free balance.`);
        }
    }

    sendLiquidationWasPerformed(agentVault: string, value: string) {
        this.send(LIQUIDATION_WAS_PERFORMED, `Liquidation was performed for agent ${agentVault} with value of ${value}`);
    }

    sendMintingCornerCase(requestId: string, indexerExpired: boolean, paymentProof: boolean) {
        if (indexerExpired) {
            this.send(MINTING_CORNER_CASE, `Minting ${requestId} expired in indexer. Unstick minting was executed.`);
        } else if (paymentProof) {
            this.send(MINTING_CORNER_CASE, `Agent requested payment proof for minting ${requestId}.`);
        } else {
            this.send(MINTING_CORNER_CASE, `Agent requested non payment proof for minting ${requestId}.`);
        }
    }

    sendRedemptionCornerCase(requestId: string, agentVault: string) {
        this.send(REDEMPTION_CORNER_CASE, `Redemption ${requestId} expired in indexer. Redemption will finish without payment for agent ${agentVault}.`);
    }

    sendRedemptionFailedOrBlocked(requestId: string, txHash: string, redeemer: string, agentVault: string, failureReason?: string) {
        if (failureReason) {
            this.send(
                REDEMPTION_FAILED_BLOCKED,
                `Redemption ${requestId} for redeemer ${redeemer} with payment transactionHash ${txHash} failed due to ${failureReason} for agent ${agentVault}.`
            );
        } else {
            this.send(
                REDEMPTION_FAILED_BLOCKED,
                `Redemption ${requestId} for redeemer ${redeemer} with payment transactionHash ${txHash} was blocked for agent ${agentVault}.`
            );
        }
    }

    sendRedemptionDefaulted(requestId: string, redeemer: string, agentVault: string) {
        this.send(REDEMPTION_DEFAULTED, `Redemption ${requestId} for redeemer ${redeemer} was defaulted for agent ${agentVault}.`);
    }

    sendRedemptionWasPerformed(requestId: string, redeemer: string, agentVault: string) {
        this.send(REDEMPTION_PERFORMED, `Redemption ${requestId} for redeemer ${redeemer} was performed for agent ${agentVault}.`);
    }

    sendCollateralTopUpAlert(agentVault: string, value: string, pool: boolean = false) {
        if (pool) {
            this.send(POOL_COLLATERAL_TOP_UP, `Agent ${agentVault} POOL was automatically topped up with collateral ${value} due to price changes.`);
        } else {
            this.send(AGENT_COLLATERAL_TOP_UP, `Agent ${agentVault} was automatically topped up with collateral ${value} due to price changes.`);
        }
    }

    sendCollateralTopUpFailedAlert(agentVault: string, value: string, pool: boolean = false) {
        if (pool) {
            this.send(
                POOL_COLLATERAL_TOP_UP_FAILED,
                `Agent ${agentVault} POOL could not be automatically topped up with collateral ${value} due to price changes.`
            );
        } else {
            this.send(
                AGENT_COLLATERAL_TOP_UP_FAILED,
                `Agent ${agentVault} could not be automatically topped up with collateral ${value} due to price changes.`
            );
        }
    }

    sendLowUnderlyingAgentBalanceFailed(agentVault: string, freeUnderlyingBalanceUBA: string) {
        this.send(
            LOW_AGENT_FREE_UNDERLYING_BALANCE,
            `Agent ${agentVault} has low freeUnderlyingBalance ${freeUnderlyingBalanceUBA} and could not be topped up.`
        );
    }

    sendLowUnderlyingAgentBalance(agentVault: string, amount: string) {
        this.send(LOW_AGENT_FREE_UNDERLYING_BALANCE, `Agent ${agentVault} was automatically topped up with underlying ${amount}.`);
    }

    sendLowBalanceOnUnderlyingOwnersAddress(ownerUnderlyingAddress: string, ownerUnderlyingBalance: string) {
        this.send(LOW_OWNERS_UNDERLYING_BALANCE, `Owner's underlying address ${ownerUnderlyingAddress} has low underlying ${ownerUnderlyingBalance}.`);
    }

    sendLowBalanceOnOwnersAddress(ownerAddress: string, balance: string, tokenSymbol: string) {
        this.send(LOW_OWNERS_NATIVE_BALANCE, `Owner ${ownerAddress} has low balance: ${balance} ${tokenSymbol}.`);
    }

    sendNoProofObtained(agentVault: string, requestId: string | null, roundId: number, requestData: string, redemption?: boolean) {
        if (!requestId) {
            this.send(
                DAILY_TASK_NO_PROOF_OBTAINED,
                `Agent ${agentVault} cannot obtain proof confirmed block height existence in round ${roundId} with requested data ${requestData}.`
            );
        } else {
            if (redemption) {
                this.send(
                    REDEMPTION_NO_PROOF_OBTAINED,
                    `Agent ${agentVault} cannot obtain proof for redemption ${requestId} in round ${roundId} with requested data ${requestData}.`
                );
            } else {
                this.send(
                    MINTING_NO_PROOF_OBTAINED,
                    `Agent ${agentVault} cannot obtain proof for minting ${requestId} in round ${roundId} with requested data ${requestData}.`
                );
            }
        }
    }

    sendAgentDestroyed(agentVault: string) {
        this.send(AGENT_DESTROYED, `Agent ${agentVault} was destroyed.`);
    }

    sendAgentCreated(agentVault: string) {
        this.send(AGENT_CREATED, `Agent ${agentVault} was created.`);
    }

    sendWithdrawVaultCollateral(agentVault: string, amount: string) {
        this.send(WITHDRAW_VAULT_COLLATERAL, `Agent ${agentVault} withdrew ${amount} of vault collateral.`);
    }

    sendWithdrawVaultCollateralAnnouncement(agentVault: string, amount: string) {
        this.send(WITHDRAW_VAULT_COLLATERAL_ANNOUNCEMENT, `Agent ${agentVault} ANNOUNCED withdrawal of ${amount} for vault collateral.`);
    }

    sendCancelVaultCollateralAnnouncement(agentVault: string) {
        this.send(CANCEL_WITHDRAW_VAULT_COLLATERAL_ANNOUNCEMENT, `Agent's ${agentVault} vault collateral withdrawal announcement was successfully cancelled.`);
    }

    sendRedeemCollateralPoolTokens(agentVault: string, amount: string) {
        this.send(REDEEM_POOL_TOKEN, `Agent ${agentVault} redeemed of ${amount} pool tokens.`);
    }

    sendCancelRedeemCollateralPoolTokensAnnouncement(agentVault: string) {
        this.send(CANCEL_POOL_TOKEN_ANNOUNCEMENT, `Agent's ${agentVault} pool token redemption announcement was successfully cancelled.`);
    }

    sendRedeemCollateralPoolTokensAnnouncement(agentVault: string, amount: string) {
        this.send(REDEEM_POOL_TOKEN_ANNOUNCEMENT, `Agent ${agentVault} ANNOUNCED redemptions of ${amount} pool tokens.`);
    }

    sendAgentSettingsUpdate(agentVault: string, settingName: string) {
        this.send(AGENT_SETTING_UPDATE, `Agent ${agentVault} setting ${settingName} was updated.`);
    }

    sendAgentAnnouncedExitAvailable(agentVault: string) {
        this.send(AGENT_EXIT_AVAILABLE_ANNOUNCEMENT, `Agent ${agentVault} ANNOUNCED exit available list.`);
    }

    sendAgentExitedAvailable(agentVault: string) {
        this.send(AGENT_EXIT_AVAILABLE, `Agent ${agentVault} exited available list.`);
    }

    sendAgentEnteredAvailable(agentVault: string) {
        this.send(AGENT_ENTER_AVAILABLE, `Agent ${agentVault} entered available list.`);
    }

    sendAgentAnnounceDestroy(agentVault: string) {
        this.send(AGENT_ANNOUNCE_DESTROY, `Agent ${agentVault} successfully announced its DESTRUCTION.`);
    }

    sendConfirmWithdrawUnderlying(agentVault: string) {
        this.send(CONFIRM_WITHDRAW_UNDERLYING, `Agent's ${agentVault} underlying withdrawal was successfully confirmed.`);
    }

    sendCancelWithdrawUnderlying(agentVault: string) {
        this.send(CANCEL_WITHDRAW_UNDERLYING, `Agent's ${agentVault} underlying withdrawal announcement was successfully cancelled.`);
    }

    sendCollateralPoolTokensRedemption(agentVault: string) {
        this.send(REDEEM_POOL_TOKEN, `Agent ${agentVault} redeemed pool tokens.`);
    }

    sendBuyCollateralPoolTokens(agentVault: string, amount: string) {
        this.send(BUY_POOL_TOKENS, `Agent ${agentVault} bought ${amount} of pool tokens successfully.`);
    }

    sendVaultCollateralDeposit(agentVault: string, amount: string) {
        this.send(VAULT_COLLATERAL_DEPOSIT, `Deposit of ${amount} to agent ${agentVault} was successful.`);
    }

    sendWithdrawPoolFees(agentVault: string, amount: string) {
        this.send(WITHDRAW_POOL_FEES, `Agent ${agentVault} withdrew pool fees ${amount} successfully.`);
    }

    sendBalancePoolFees(agentVault: string, amount: string) {
        this.send(BALANCE_POOL_FEES, `Agent ${agentVault} has following pool fees balance ${amount}.`);
    }

    sendSelfClose(agentVault: string) {
        this.send(SELF_CLOSE, `Agent ${agentVault} self closed successfully.`);
    }

    sendActiveWithdrawal(agentVault: string) {
        this.send(ACTIVE_WITHDRAWAL, `Agent ${agentVault} already has an active underlying withdrawal announcement.`);
    }

    sendNoActiveWithdrawal(agentVault: string) {
        this.send(NO_ACTIVE_WITHDRAWAL, `Agent ${agentVault} has NO active underlying withdrawal announcement.`);
    }

    sendAnnounceUnderlyingWithdrawal(agentVault: string, paymentReference: string) {
        this.send(ANNOUNCE_WITHDRAW_UNDERLYING, `Agent ${agentVault} announced underlying withdrawal with payment reference ${paymentReference}.`);
    }

    sendUnderlyingWithdrawalPerformed(agentVault: string, txHash: string) {
        this.send(WITHDRAW_UNDERLYING, `Agent ${agentVault} withdrew underlying with transaction ${txHash}.`);
    }

    sendMintingExecuted(agentVault: string, requestId: string) {
        this.send(MINTING_EXECUTED, `Minting ${requestId} executed for ${agentVault}.`);
    }

    sendMintingDeleted(agentVault: string, requestId: string) {
        this.send(MINTING_DELETED, `Minting ${requestId} deleted for ${agentVault}.`);
    }

    sendMintingStared(agentVault: string, requestId: string) {
        this.send(MINTING_STARTED, `Minting ${requestId} started for ${agentVault}.`);
    }

    sendRedemptionStarted(agentVault: string, requestId: string) {
        this.send(REDEMPTION_STARTED, `Redemption ${requestId} started for ${agentVault}.`);
    }

    sendRedemptionPaid(agentVault: string, requestId: string) {
        this.send(REDEMPTION_PAID, `Redemption ${requestId} was paid for ${agentVault}.`);
    }

    sendRedemptionRequestPaymentProof(agentVault: string, requestId: string) {
        this.send(REDEMPTION_PAYMENT_PROOF, `Payment proof for redemption ${requestId} was requested for ${agentVault}.`);
    }

    sendDelegatePoolCollateral(agentVault: string, poolCollateral: string, recipient: string, bips: string) {
        this.send(POOL_DELEGATE, `Agent ${agentVault} delegated pool collateral ${poolCollateral} to ${recipient} with ${bips}.`);
    }

    sendUndelegatePoolCollateral(agentVault: string, poolCollateral: string) {
        this.send(POOL_UNDELEGATE, `Agent ${agentVault} undelegated all pool collateral ${poolCollateral}.`);
    }

    sendAgentCannotUpdateSettingExpired(agentVault: string, setting: string) {
        this.send(AGENT_SETTING_UPDATE_FAILED, `Agent ${agentVault} could not update setting ${setting}, as it is not valid anymore. Try announcing setting update again.`);
    }

    sendAgentCannotWithdrawCollateral(agentVault: string, amount: string, type: string) {
        this.send(WITHDRAWAL_FAILED, `Agent ${agentVault} could not withdrew ${type} collateral of ${amount}. Cancel ${type} collateral withdrawal announcement and try again.`);
    }
}
