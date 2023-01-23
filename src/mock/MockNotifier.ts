const CCB_TITLE = "CCB ALERT";
const FULL_LIQUIDATION_TITLE = "FULL LIQUIDATION ALERT";
const MINTING_CORNER_CASE = "MINTING ALERT";
const REDEMPTION_CORNER_CASE = "REDEMPTION ALERT";
const NO_PROOF = "NO PROOF OBTAINED ALERT";
const REDEMPTION_FAILED_BLOCKED = "REDEMPTION FAILED OR BLOCKED ALERT";
const LOW_FREE_UNDERLYING_BALANCE = "LOW FREE UNDERLYING BALANCE ALERT";

export class MockNotifier {

    send(title: string, message?: string) {
        console.log(title + ": " + message);
    }

    sendCCBAlert(agentVault: string) {
        this.send(CCB_TITLE, `Agent ${agentVault} is in collateral call band.`);
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

    sendNoProofObtained(roundId: number, requestData: string) {
        this.send(NO_PROOF, `Cannot obtain proof for round ${roundId} with requested data ${requestData}.`);
    }

    sendRedemptionFailedOrBlocked(requestId: string, txHash: string, redeemer: string, failureReason?: string) {
        if (failureReason) {
            this.send(REDEMPTION_FAILED_BLOCKED, `Redemption ${requestId} for redeemer ${redeemer} with payment transactionHash ${txHash} failed due to ${failureReason}.`);
        } else {
            this.send(REDEMPTION_FAILED_BLOCKED, `Redemption ${requestId} for redeemer ${redeemer} with payment transactionHash ${txHash} was blocked`);
        }
    }

    sendLowUnderlyingBalance(agentVault: string, freeUnderlyingBalanceUBA: string) {
        this.send(LOW_FREE_UNDERLYING_BALANCE, `Agent ${agentVault} has low freeUnderlyingBalance ${freeUnderlyingBalanceUBA}.`);
    }

}