const CCB_TITLE = "CCB ALERT";
const LIQUIDATION_STARTED_ALERT = "LIQUIDATION STARTED ALERT";
const FULL_LIQUIDATION_TITLE = "FULL LIQUIDATION ALERT";
const LIQUIDATION_WAS_PERFORMED_ALERT = "LIQUIDATION WAS PERFORMED ALERT";
const MINTING_CORNER_CASE = "MINTING ALERT";
const MINTING_NO_PROOF_OBTAINED = "NO PROOF OBTAINED FOR MINTING ALERT";
const REDEMPTION_CORNER_CASE = "REDEMPTION ALERT";
const REDEMPTION_FAILED_BLOCKED = "REDEMPTION FAILED OR BLOCKED ALERT";
const REDEMPTION_DEFAULTED = "REDEMPTION DEFAULTED ALERT";
const REDEMPTION_NO_PROOF_OBTAINED = "NO PROOF OBTAINED FOR REDEMPTION ALERT";
const COLLATERAL_TOP_UP_ALERT = "COLLATERAL TOP UP ALERT";
const COLLATERAL_TOP_UP_FAILED_ALERT = "COLLATERAL TOP UP FAILED ALERT";
const LOW_AGENT_FREE_UNDERLYING_BALANCE = "LOW FREE UNDERLYING BALANCE ALERT";
const LOW_OWNERS_NATIVE_BALANCE = "LOW BALANCE IN OWNER'S ADDRESS ALERT";
const LOW_OWNERS_UNDERLYING_BALANCE = "LOW BALANCE IN OWNER'S UNDERLYING ADDRESS ALERT";

export class Alerting {

    send(title: string, message?: string) {
        console.log(title + ": " + message);
    }

    sendCCBAlert(agentVault: string) {
        this.send(CCB_TITLE, `Agent ${agentVault} is in collateral call band.`);
    }

    sendLiquidationStartAlert(agentVault: string) {
        this.send(LIQUIDATION_STARTED_ALERT, `Liquidation has started for agent ${agentVault}.`);
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

    sendLiquidationWasPerformed(agentVault: string) {
        this.send(LIQUIDATION_WAS_PERFORMED_ALERT, `Liquidation was performed for agent ${agentVault}`);
    }

    sendMintingCornerCase(requestId: string, indexerExpired: boolean = false) {
        if (indexerExpired) {
            this.send(MINTING_CORNER_CASE, `Minting ${requestId} expired in indexer. Unstick minting was executed.`);
        } else {
            this.send(MINTING_CORNER_CASE, `Agent requested payment proof for  minting ${requestId}.`);
        }
    }

    sendRedemptionCornerCase(requestId: string) {
        this.send(REDEMPTION_CORNER_CASE, `Redemption ${requestId} expired in indexer. Redemption will finish without payment.`);
    }

    sendRedemptionFailedOrBlocked(requestId: string, txHash: string, redeemer: string, failureReason?: string) {
        if (failureReason) {
            this.send(REDEMPTION_FAILED_BLOCKED, `Redemption ${requestId} for redeemer ${redeemer} with payment transactionHash ${txHash} failed due to ${failureReason}.`);
        } else {
            this.send(REDEMPTION_FAILED_BLOCKED, `Redemption ${requestId} for redeemer ${redeemer} with payment transactionHash ${txHash} was blocked.`);
        }
    }

    sendRedemptionDefaulted(requestId: string, txHash: string, redeemer: string) {
        this.send(REDEMPTION_DEFAULTED, `Redemption ${requestId} for redeemer ${redeemer} was defaulted.`);
    }

    sendCollateralTopUpAlert(agentVault: string, value: string) {
        this.send(COLLATERAL_TOP_UP_ALERT, `Agent ${agentVault} was automatically topped up with collateral ${value} due to price changes.`);
    }

    sendCollateralTopUpFailedAlert(agentVault: string, value: string) {
        this.send(COLLATERAL_TOP_UP_FAILED_ALERT, `Agent ${agentVault} could not be automatically topped up with collateral ${value} due to price changes.`);
    }

    sendLowUnderlyingAgentBalanceFailed(agentVault: string, freeUnderlyingBalanceUBA: string) {
        this.send(LOW_AGENT_FREE_UNDERLYING_BALANCE, `Agent ${agentVault} has low freeUnderlyingBalance ${freeUnderlyingBalanceUBA} and could not be topped up.`);
    }

    sendLowUnderlyingAgentBalance(agentVault: string, amount: string) {
        this.send(LOW_AGENT_FREE_UNDERLYING_BALANCE, `Agent ${agentVault} was automatically topped up with underlying ${amount}.`);
    }

    sendLowBalanceOnUnderlyingOwnersAddress(ownerUnderlyingAddress: string, ownerUnderlyingBalance: string) {
        this.send(LOW_OWNERS_UNDERLYING_BALANCE, `Owner's underlying address ${ownerUnderlyingAddress} has low underlying ${ownerUnderlyingBalance}.`);
    }

    sendLowBalanceOnOwnersAddress(ownerAddress: string, balance: string) {
        this.send(LOW_OWNERS_NATIVE_BALANCE, `Owner ${ownerAddress} has low balance ${balance}.`);
    }

    sendNoProofObtained(agentVault: string, requestId: string, roundId: number, requestData: string, redemption?: boolean) {
        if (redemption) {
            this.send(REDEMPTION_NO_PROOF_OBTAINED, `Agent ${agentVault} cannot obtain proof for redemption ${requestId} in round ${roundId} with requested data ${requestData}.`);
        } else {
            this.send(MINTING_NO_PROOF_OBTAINED, `Agent ${agentVault} cannot obtain proof for minting ${requestId} in round ${roundId} with requested data ${requestData}.`);
        }
    }

}