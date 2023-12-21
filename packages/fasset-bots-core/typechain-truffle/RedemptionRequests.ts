/* Autogenerated file. Do not edit manually. */
/* tslint:disable */
/* eslint-disable */

import type { Truffle } from "./types";

import BN from "bn.js";
import { EventData, PastEventOptions } from "web3-eth-contract";

export interface RedemptionRequestsContract
  extends Truffle.Contract<RedemptionRequestsInstance> {
  "new"(meta?: Truffle.TransactionDetails): Promise<RedemptionRequestsInstance>;
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

export interface LiquidationEnded {
  name: "LiquidationEnded";
  args: {
    agentVault: string;
    0: string;
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
    executor: string;
    executorFeeNatWei: BN;
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
    10: string;
    11: BN;
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

export type AllEvents =
  | DustChanged
  | LiquidationEnded
  | RedeemedInCollateral
  | RedemptionRequestIncomplete
  | RedemptionRequested
  | SelfClose;

export interface RedemptionRequestsInstance extends Truffle.ContractInstance {
  maxRedemptionFromAgent(
    _agentVault: string,
    txDetails?: Truffle.TransactionDetails
  ): Promise<BN>;

  methods: {
    maxRedemptionFromAgent(
      _agentVault: string,
      txDetails?: Truffle.TransactionDetails
    ): Promise<BN>;
  };

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