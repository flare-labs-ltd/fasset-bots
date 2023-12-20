/* Autogenerated file. Do not edit manually. */
/* tslint:disable */
/* eslint-disable */

import BN from "bn.js";
import { EventData, PastEventOptions } from "web3-eth-contract";

export interface IAssetManagerEventsContract
  extends Truffle.Contract<IAssetManagerEventsInstance> {
  "new"(
    meta?: Truffle.TransactionDetails
  ): Promise<IAssetManagerEventsInstance>;
}

export interface AgentAvailable {
  name: "AgentAvailable";
  args: {
    agentVault: string;
    feeBIPS: BN;
    mintingVaultCollateralRatioBIPS: BN;
    mintingPoolCollateralRatioBIPS: BN;
    freeCollateralLots: BN;
    0: string;
    1: BN;
    2: BN;
    3: BN;
    4: BN;
  };
}

export interface AgentCollateralTypeChanged {
  name: "AgentCollateralTypeChanged";
  args: {
    agentVault: string;
    collateralClass: BN;
    token: string;
    0: string;
    1: BN;
    2: string;
  };
}

export interface AgentDestroyAnnounced {
  name: "AgentDestroyAnnounced";
  args: {
    agentVault: string;
    destroyAllowedAt: BN;
    0: string;
    1: BN;
  };
}

export interface AgentDestroyed {
  name: "AgentDestroyed";
  args: {
    agentVault: string;
    0: string;
  };
}

export interface AgentInCCB {
  name: "AgentInCCB";
  args: {
    agentVault: string;
    timestamp: BN;
    0: string;
    1: BN;
  };
}

export interface AgentSettingChangeAnnounced {
  name: "AgentSettingChangeAnnounced";
  args: {
    agentVault: string;
    name: string;
    value: BN;
    validAt: BN;
    0: string;
    1: string;
    2: BN;
    3: BN;
  };
}

export interface AgentSettingChanged {
  name: "AgentSettingChanged";
  args: {
    agentVault: string;
    name: string;
    value: BN;
    0: string;
    1: string;
    2: BN;
  };
}

export interface AgentVaultCreated {
  name: "AgentVaultCreated";
  args: {
    owner: string;
    agentVault: string;
    collateralPool: string;
    underlyingAddress: string;
    vaultCollateralToken: string;
    feeBIPS: BN;
    poolFeeShareBIPS: BN;
    mintingVaultCollateralRatioBIPS: BN;
    mintingPoolCollateralRatioBIPS: BN;
    buyFAssetByAgentFactorBIPS: BN;
    poolExitCollateralRatioBIPS: BN;
    poolTopupCollateralRatioBIPS: BN;
    poolTopupTokenPriceFactorBIPS: BN;
    0: string;
    1: string;
    2: string;
    3: string;
    4: string;
    5: BN;
    6: BN;
    7: BN;
    8: BN;
    9: BN;
    10: BN;
    11: BN;
    12: BN;
  };
}

export interface AvailableAgentExitAnnounced {
  name: "AvailableAgentExitAnnounced";
  args: {
    agentVault: string;
    exitAllowedAt: BN;
    0: string;
    1: BN;
  };
}

export interface AvailableAgentExited {
  name: "AvailableAgentExited";
  args: {
    agentVault: string;
    0: string;
  };
}

export interface CollateralRatiosChanged {
  name: "CollateralRatiosChanged";
  args: {
    collateralClass: BN;
    collateralToken: string;
    minCollateralRatioBIPS: BN;
    ccbMinCollateralRatioBIPS: BN;
    safetyMinCollateralRatioBIPS: BN;
    0: BN;
    1: string;
    2: BN;
    3: BN;
    4: BN;
  };
}

export interface CollateralReservationDeleted {
  name: "CollateralReservationDeleted";
  args: {
    agentVault: string;
    minter: string;
    collateralReservationId: BN;
    reservedAmountUBA: BN;
    0: string;
    1: string;
    2: BN;
    3: BN;
  };
}

export interface CollateralReserved {
  name: "CollateralReserved";
  args: {
    agentVault: string;
    minter: string;
    collateralReservationId: BN;
    valueUBA: BN;
    feeUBA: BN;
    firstUnderlyingBlock: BN;
    lastUnderlyingBlock: BN;
    lastUnderlyingTimestamp: BN;
    paymentAddress: string;
    paymentReference: string;
    0: string;
    1: string;
    2: BN;
    3: BN;
    4: BN;
    5: BN;
    6: BN;
    7: BN;
    8: string;
    9: string;
  };
}

export interface CollateralTypeAdded {
  name: "CollateralTypeAdded";
  args: {
    collateralClass: BN;
    token: string;
    decimals: BN;
    directPricePair: boolean;
    assetFtsoSymbol: string;
    tokenFtsoSymbol: string;
    minCollateralRatioBIPS: BN;
    ccbMinCollateralRatioBIPS: BN;
    safetyMinCollateralRatioBIPS: BN;
    0: BN;
    1: string;
    2: BN;
    3: boolean;
    4: string;
    5: string;
    6: BN;
    7: BN;
    8: BN;
  };
}

export interface CollateralTypeDeprecated {
  name: "CollateralTypeDeprecated";
  args: {
    collateralClass: BN;
    collateralToken: string;
    validUntil: BN;
    0: BN;
    1: string;
    2: BN;
  };
}

export interface ContractChanged {
  name: "ContractChanged";
  args: {
    name: string;
    value: string;
    0: string;
    1: string;
  };
}

export interface CurrentUnderlyingBlockUpdated {
  name: "CurrentUnderlyingBlockUpdated";
  args: {
    underlyingBlockNumber: BN;
    underlyingBlockTimestamp: BN;
    updatedAt: BN;
    0: BN;
    1: BN;
    2: BN;
  };
}

export interface DuplicatePaymentConfirmed {
  name: "DuplicatePaymentConfirmed";
  args: {
    agentVault: string;
    transactionHash1: string;
    transactionHash2: string;
    0: string;
    1: string;
    2: string;
  };
}

export interface DustChanged {
  name: "DustChanged";
  args: {
    agentVault: string;
    dustUBA: BN;
    0: string;
    1: BN;
  };
}

export interface DustConvertedToTicket {
  name: "DustConvertedToTicket";
  args: {
    agentVault: string;
    redemptionTicketId: BN;
    valueUBA: BN;
    0: string;
    1: BN;
    2: BN;
  };
}

export interface FullLiquidationStarted {
  name: "FullLiquidationStarted";
  args: {
    agentVault: string;
    timestamp: BN;
    0: string;
    1: BN;
  };
}

export interface IllegalPaymentConfirmed {
  name: "IllegalPaymentConfirmed";
  args: {
    agentVault: string;
    transactionHash: string;
    0: string;
    1: string;
  };
}

export interface LiquidationEnded {
  name: "LiquidationEnded";
  args: {
    agentVault: string;
    0: string;
  };
}

export interface LiquidationPerformed {
  name: "LiquidationPerformed";
  args: {
    agentVault: string;
    liquidator: string;
    valueUBA: BN;
    0: string;
    1: string;
    2: BN;
  };
}

export interface LiquidationStarted {
  name: "LiquidationStarted";
  args: {
    agentVault: string;
    timestamp: BN;
    0: string;
    1: BN;
  };
}

export interface MintingExecuted {
  name: "MintingExecuted";
  args: {
    agentVault: string;
    collateralReservationId: BN;
    redemptionTicketId: BN;
    mintedAmountUBA: BN;
    agentFeeUBA: BN;
    poolFeeUBA: BN;
    0: string;
    1: BN;
    2: BN;
    3: BN;
    4: BN;
    5: BN;
  };
}

export interface MintingPaymentDefault {
  name: "MintingPaymentDefault";
  args: {
    agentVault: string;
    minter: string;
    collateralReservationId: BN;
    reservedAmountUBA: BN;
    0: string;
    1: string;
    2: BN;
    3: BN;
  };
}

export interface PoolTokenRedemptionAnnounced {
  name: "PoolTokenRedemptionAnnounced";
  args: {
    agentVault: string;
    amountWei: BN;
    withdrawalAllowedAt: BN;
    0: string;
    1: BN;
    2: BN;
  };
}

export interface RedeemedInCollateral {
  name: "RedeemedInCollateral";
  args: {
    agentVault: string;
    redeemer: string;
    redemptionAmountUBA: BN;
    paidVaultCollateralWei: BN;
    0: string;
    1: string;
    2: BN;
    3: BN;
  };
}

export interface RedemptionDefault {
  name: "RedemptionDefault";
  args: {
    agentVault: string;
    redeemer: string;
    redemptionAmountUBA: BN;
    redeemedVaultCollateralWei: BN;
    redeemedPoolCollateralWei: BN;
    requestId: BN;
    0: string;
    1: string;
    2: BN;
    3: BN;
    4: BN;
    5: BN;
  };
}

export interface RedemptionPaymentBlocked {
  name: "RedemptionPaymentBlocked";
  args: {
    agentVault: string;
    redeemer: string;
    transactionHash: string;
    redemptionAmountUBA: BN;
    spentUnderlyingUBA: BN;
    requestId: BN;
    0: string;
    1: string;
    2: string;
    3: BN;
    4: BN;
    5: BN;
  };
}

export interface RedemptionPaymentFailed {
  name: "RedemptionPaymentFailed";
  args: {
    agentVault: string;
    redeemer: string;
    transactionHash: string;
    spentUnderlyingUBA: BN;
    requestId: BN;
    failureReason: string;
    0: string;
    1: string;
    2: string;
    3: BN;
    4: BN;
    5: string;
  };
}

export interface RedemptionPerformed {
  name: "RedemptionPerformed";
  args: {
    agentVault: string;
    redeemer: string;
    transactionHash: string;
    redemptionAmountUBA: BN;
    spentUnderlyingUBA: BN;
    requestId: BN;
    0: string;
    1: string;
    2: string;
    3: BN;
    4: BN;
    5: BN;
  };
}

export interface RedemptionRequestIncomplete {
  name: "RedemptionRequestIncomplete";
  args: {
    redeemer: string;
    remainingLots: BN;
    0: string;
    1: BN;
  };
}

export interface RedemptionRequested {
  name: "RedemptionRequested";
  args: {
    agentVault: string;
    redeemer: string;
    requestId: BN;
    paymentAddress: string;
    valueUBA: BN;
    feeUBA: BN;
    firstUnderlyingBlock: BN;
    lastUnderlyingBlock: BN;
    lastUnderlyingTimestamp: BN;
    paymentReference: string;
    0: string;
    1: string;
    2: BN;
    3: string;
    4: BN;
    5: BN;
    6: BN;
    7: BN;
    8: BN;
    9: string;
  };
}

export interface SelfClose {
  name: "SelfClose";
  args: {
    agentVault: string;
    valueUBA: BN;
    0: string;
    1: BN;
  };
}

export interface SettingArrayChanged {
  name: "SettingArrayChanged";
  args: {
    name: string;
    value: BN[];
    0: string;
    1: BN[];
  };
}

export interface SettingChanged {
  name: "SettingChanged";
  args: {
    name: string;
    value: BN;
    0: string;
    1: BN;
  };
}

export interface UnderlyingBalanceChanged {
  name: "UnderlyingBalanceChanged";
  args: {
    agentVault: string;
    underlyingBalanceUBA: BN;
    0: string;
    1: BN;
  };
}

export interface UnderlyingBalanceTooLow {
  name: "UnderlyingBalanceTooLow";
  args: {
    agentVault: string;
    balance: BN;
    requiredBalance: BN;
    0: string;
    1: BN;
    2: BN;
  };
}

export interface UnderlyingBalanceToppedUp {
  name: "UnderlyingBalanceToppedUp";
  args: {
    agentVault: string;
    transactionHash: string;
    depositedUBA: BN;
    0: string;
    1: string;
    2: BN;
  };
}

export interface UnderlyingWithdrawalAnnounced {
  name: "UnderlyingWithdrawalAnnounced";
  args: {
    agentVault: string;
    announcementId: BN;
    paymentReference: string;
    0: string;
    1: BN;
    2: string;
  };
}

export interface UnderlyingWithdrawalCancelled {
  name: "UnderlyingWithdrawalCancelled";
  args: {
    agentVault: string;
    announcementId: BN;
    0: string;
    1: BN;
  };
}

export interface UnderlyingWithdrawalConfirmed {
  name: "UnderlyingWithdrawalConfirmed";
  args: {
    agentVault: string;
    spentUBA: BN;
    transactionHash: string;
    announcementId: BN;
    0: string;
    1: BN;
    2: string;
    3: BN;
  };
}

export interface VaultCollateralWithdrawalAnnounced {
  name: "VaultCollateralWithdrawalAnnounced";
  args: {
    agentVault: string;
    amountWei: BN;
    withdrawalAllowedAt: BN;
    0: string;
    1: BN;
    2: BN;
  };
}

type AllEvents =
  | AgentAvailable
  | AgentCollateralTypeChanged
  | AgentDestroyAnnounced
  | AgentDestroyed
  | AgentInCCB
  | AgentSettingChangeAnnounced
  | AgentSettingChanged
  | AgentVaultCreated
  | AvailableAgentExitAnnounced
  | AvailableAgentExited
  | CollateralRatiosChanged
  | CollateralReservationDeleted
  | CollateralReserved
  | CollateralTypeAdded
  | CollateralTypeDeprecated
  | ContractChanged
  | CurrentUnderlyingBlockUpdated
  | DuplicatePaymentConfirmed
  | DustChanged
  | DustConvertedToTicket
  | FullLiquidationStarted
  | IllegalPaymentConfirmed
  | LiquidationEnded
  | LiquidationPerformed
  | LiquidationStarted
  | MintingExecuted
  | MintingPaymentDefault
  | PoolTokenRedemptionAnnounced
  | RedeemedInCollateral
  | RedemptionDefault
  | RedemptionPaymentBlocked
  | RedemptionPaymentFailed
  | RedemptionPerformed
  | RedemptionRequestIncomplete
  | RedemptionRequested
  | SelfClose
  | SettingArrayChanged
  | SettingChanged
  | UnderlyingBalanceChanged
  | UnderlyingBalanceTooLow
  | UnderlyingBalanceToppedUp
  | UnderlyingWithdrawalAnnounced
  | UnderlyingWithdrawalCancelled
  | UnderlyingWithdrawalConfirmed
  | VaultCollateralWithdrawalAnnounced;

export interface IAssetManagerEventsInstance extends Truffle.ContractInstance {
  methods: {};

  getPastEvents(event: string): Promise<EventData[]>;
  getPastEvents(
    event: string,
    options: PastEventOptions,
    callback: (error: Error, event: EventData) => void
  ): Promise<EventData[]>;
  getPastEvents(event: string, options: PastEventOptions): Promise<EventData[]>;
  getPastEvents(
    event: string,
    callback: (error: Error, event: EventData) => void
  ): Promise<EventData[]>;
}