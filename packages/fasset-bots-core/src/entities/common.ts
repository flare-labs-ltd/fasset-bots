// constants
export const ADDRESS_LENGTH = 42;
export const BYTES32_LENGTH = 66;

// enums
export enum AgentMintingState {
    DONE = "done",
    STARTED = "started",
    REQUEST_NON_PAYMENT_PROOF = "requestedNonPaymentProof",
    REQUEST_PAYMENT_PROOF = "requestedPaymentProof",
}

export enum AgentRedemptionState {
    DONE = "done",
    STARTED = "started",
    PAYING = "paying",
    PAID = "paid",
    UNPAID = "unpaid",
    REQUESTED_PROOF = "requestedProof",
    REQUESTED_REJECTION_PROOF = "requestedRejectionProof",
}

export enum AgentRedemptionFinalState {
    REJECTED = "rejected",
    PERFORMED = "performed",
    FAILED = "failed",
    BLOCKED = "blocked",
    EXPIRED_PAYING = "expired_paying",
    EXPIRED_PAID = "expired_paid",
    EXPIRED_UNPAID = "expired_unpaid",
}

export enum AgentUnderlyingPaymentState {
    PAYING = "paying",
    PAID = "paid",
    REQUESTED_PROOF = "requestedProof",
    DONE = "done",
}

export enum AgentUnderlyingPaymentType {
    TOP_UP = "top_up",
    WITHDRAWAL = "withdrawal",
}

export enum AgentUpdateSettingState {
    WAITING = "waiting",
    DONE = "done",
}

export enum AgentSettingName {
    FEE = "feeBIPS",
    POOL_FEE_SHARE = "poolFeeShareBIPS",
    MINTING_VAULT_CR = "mintingVaultCollateralRatioBIPS",
    MINTING_POOL_CR = "mintingPoolCollateralRatioBIPS",
    BUY_FASSET_FACTOR = "buyFAssetByAgentFactorBIPS",
    POOL_EXIT_CR = "poolExitCollateralRatioBIPS",
    POOL_TOP_UP_CR = "poolTopupCollateralRatioBIPS",
    POOL_TOP_UP_TOKEN_PRICE_FACTOR = "poolTopupTokenPriceFactorBIPS"
}
