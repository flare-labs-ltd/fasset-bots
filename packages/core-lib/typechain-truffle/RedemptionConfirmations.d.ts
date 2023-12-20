/* Autogenerated file. Do not edit manually. */
/* tslint:disable */
/* eslint-disable */

import BN from "bn.js";
import { EventData, PastEventOptions } from "web3-eth-contract";

export interface RedemptionConfirmationsContract
  extends Truffle.Contract<RedemptionConfirmationsInstance> {
  "new"(
    meta?: Truffle.TransactionDetails
  ): Promise<RedemptionConfirmationsInstance>;
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

export interface LiquidationEnded {
  name: "LiquidationEnded";
  args: {
    agentVault: string;
    0: string;
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

type AllEvents =
  | FullLiquidationStarted
  | LiquidationEnded
  | RedemptionDefault
  | RedemptionPaymentBlocked
  | RedemptionPaymentFailed
  | RedemptionPerformed
  | UnderlyingBalanceChanged
  | UnderlyingBalanceTooLow;

export interface RedemptionConfirmationsInstance
  extends Truffle.ContractInstance {
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