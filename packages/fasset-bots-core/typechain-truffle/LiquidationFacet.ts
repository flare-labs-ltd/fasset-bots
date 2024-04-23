/* Autogenerated file. Do not edit manually. */
/* tslint:disable */
/* eslint-disable */

import type { Truffle } from "./types";

import BN from "bn.js";
import { EventData, PastEventOptions } from "web3-eth-contract";

export interface LiquidationFacetContract
  extends Truffle.Contract<LiquidationFacetInstance> {
  "new"(meta?: Truffle.TransactionDetails): Promise<LiquidationFacetInstance>;
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

export interface RedemptionTicketDeleted {
  name: "RedemptionTicketDeleted";
  args: {
    agentVault: string;
    redemptionTicketId: BN;
    0: string;
    1: BN;
  };
}

export interface RedemptionTicketUpdated {
  name: "RedemptionTicketUpdated";
  args: {
    agentVault: string;
    redemptionTicketId: BN;
    ticketValueUBA: BN;
    0: string;
    1: BN;
    2: BN;
  };
}

export type AllEvents =
  | AgentInCCB
  | DustChanged
  | LiquidationEnded
  | LiquidationPerformed
  | LiquidationStarted
  | RedemptionTicketDeleted
  | RedemptionTicketUpdated;

export interface LiquidationFacetInstance extends Truffle.ContractInstance {
  endLiquidation: {
    (_agentVault: string, txDetails?: Truffle.TransactionDetails): Promise<
      Truffle.TransactionResponse<AllEvents>
    >;
    call(
      _agentVault: string,
      txDetails?: Truffle.TransactionDetails
    ): Promise<void>;
    sendTransaction(
      _agentVault: string,
      txDetails?: Truffle.TransactionDetails
    ): Promise<string>;
    estimateGas(
      _agentVault: string,
      txDetails?: Truffle.TransactionDetails
    ): Promise<number>;
  };

  liquidate: {
    (
      _agentVault: string,
      _amountUBA: number | BN | string,
      txDetails?: Truffle.TransactionDetails
    ): Promise<Truffle.TransactionResponse<AllEvents>>;
    call(
      _agentVault: string,
      _amountUBA: number | BN | string,
      txDetails?: Truffle.TransactionDetails
    ): Promise<{ 0: BN; 1: BN; 2: BN }>;
    sendTransaction(
      _agentVault: string,
      _amountUBA: number | BN | string,
      txDetails?: Truffle.TransactionDetails
    ): Promise<string>;
    estimateGas(
      _agentVault: string,
      _amountUBA: number | BN | string,
      txDetails?: Truffle.TransactionDetails
    ): Promise<number>;
  };

  startLiquidation: {
    (_agentVault: string, txDetails?: Truffle.TransactionDetails): Promise<
      Truffle.TransactionResponse<AllEvents>
    >;
    call(
      _agentVault: string,
      txDetails?: Truffle.TransactionDetails
    ): Promise<{ 0: BN; 1: BN }>;
    sendTransaction(
      _agentVault: string,
      txDetails?: Truffle.TransactionDetails
    ): Promise<string>;
    estimateGas(
      _agentVault: string,
      txDetails?: Truffle.TransactionDetails
    ): Promise<number>;
  };

  methods: {
    endLiquidation: {
      (_agentVault: string, txDetails?: Truffle.TransactionDetails): Promise<
        Truffle.TransactionResponse<AllEvents>
      >;
      call(
        _agentVault: string,
        txDetails?: Truffle.TransactionDetails
      ): Promise<void>;
      sendTransaction(
        _agentVault: string,
        txDetails?: Truffle.TransactionDetails
      ): Promise<string>;
      estimateGas(
        _agentVault: string,
        txDetails?: Truffle.TransactionDetails
      ): Promise<number>;
    };

    liquidate: {
      (
        _agentVault: string,
        _amountUBA: number | BN | string,
        txDetails?: Truffle.TransactionDetails
      ): Promise<Truffle.TransactionResponse<AllEvents>>;
      call(
        _agentVault: string,
        _amountUBA: number | BN | string,
        txDetails?: Truffle.TransactionDetails
      ): Promise<{ 0: BN; 1: BN; 2: BN }>;
      sendTransaction(
        _agentVault: string,
        _amountUBA: number | BN | string,
        txDetails?: Truffle.TransactionDetails
      ): Promise<string>;
      estimateGas(
        _agentVault: string,
        _amountUBA: number | BN | string,
        txDetails?: Truffle.TransactionDetails
      ): Promise<number>;
    };

    startLiquidation: {
      (_agentVault: string, txDetails?: Truffle.TransactionDetails): Promise<
        Truffle.TransactionResponse<AllEvents>
      >;
      call(
        _agentVault: string,
        txDetails?: Truffle.TransactionDetails
      ): Promise<{ 0: BN; 1: BN }>;
      sendTransaction(
        _agentVault: string,
        txDetails?: Truffle.TransactionDetails
      ): Promise<string>;
      estimateGas(
        _agentVault: string,
        txDetails?: Truffle.TransactionDetails
      ): Promise<number>;
    };
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
