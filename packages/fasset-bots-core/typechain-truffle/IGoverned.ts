/* Autogenerated file. Do not edit manually. */
/* tslint:disable */
/* eslint-disable */

import type { Truffle } from "./types";

import BN from "bn.js";
import { EventData, PastEventOptions } from "web3-eth-contract";

export interface IGovernedContract extends Truffle.Contract<IGovernedInstance> {
  "new"(meta?: Truffle.TransactionDetails): Promise<IGovernedInstance>;
}

export interface GovernanceCallTimelocked {
  name: "GovernanceCallTimelocked";
  args: {
    encodedCall: string;
    encodedCallHash: string;
    allowedAfterTimestamp: BN;
    0: string;
    1: string;
    2: BN;
  };
}

export interface GovernanceInitialised {
  name: "GovernanceInitialised";
  args: {
    initialGovernance: string;
    0: string;
  };
}

export interface GovernedProductionModeEntered {
  name: "GovernedProductionModeEntered";
  args: {
    governanceSettings: string;
    0: string;
  };
}

export interface TimelockedGovernanceCallCanceled {
  name: "TimelockedGovernanceCallCanceled";
  args: {
    encodedCallHash: string;
    0: string;
  };
}

export interface TimelockedGovernanceCallExecuted {
  name: "TimelockedGovernanceCallExecuted";
  args: {
    encodedCallHash: string;
    0: string;
  };
}

export type AllEvents =
  | GovernanceCallTimelocked
  | GovernanceInitialised
  | GovernedProductionModeEntered
  | TimelockedGovernanceCallCanceled
  | TimelockedGovernanceCallExecuted;

export interface IGovernedInstance extends Truffle.ContractInstance {
  cancelGovernanceCall: {
    (_encodedCall: string, txDetails?: Truffle.TransactionDetails): Promise<
      Truffle.TransactionResponse<AllEvents>
    >;
    call(
      _encodedCall: string,
      txDetails?: Truffle.TransactionDetails
    ): Promise<void>;
    sendTransaction(
      _encodedCall: string,
      txDetails?: Truffle.TransactionDetails
    ): Promise<string>;
    estimateGas(
      _encodedCall: string,
      txDetails?: Truffle.TransactionDetails
    ): Promise<number>;
  };

  executeGovernanceCall: {
    (_encodedCall: string, txDetails?: Truffle.TransactionDetails): Promise<
      Truffle.TransactionResponse<AllEvents>
    >;
    call(
      _encodedCall: string,
      txDetails?: Truffle.TransactionDetails
    ): Promise<void>;
    sendTransaction(
      _encodedCall: string,
      txDetails?: Truffle.TransactionDetails
    ): Promise<string>;
    estimateGas(
      _encodedCall: string,
      txDetails?: Truffle.TransactionDetails
    ): Promise<number>;
  };

  governance(txDetails?: Truffle.TransactionDetails): Promise<string>;

  governanceSettings(txDetails?: Truffle.TransactionDetails): Promise<string>;

  isExecutor(
    _address: string,
    txDetails?: Truffle.TransactionDetails
  ): Promise<boolean>;

  productionMode(txDetails?: Truffle.TransactionDetails): Promise<boolean>;

  switchToProductionMode: {
    (txDetails?: Truffle.TransactionDetails): Promise<
      Truffle.TransactionResponse<AllEvents>
    >;
    call(txDetails?: Truffle.TransactionDetails): Promise<void>;
    sendTransaction(txDetails?: Truffle.TransactionDetails): Promise<string>;
    estimateGas(txDetails?: Truffle.TransactionDetails): Promise<number>;
  };

  methods: {
    cancelGovernanceCall: {
      (_encodedCall: string, txDetails?: Truffle.TransactionDetails): Promise<
        Truffle.TransactionResponse<AllEvents>
      >;
      call(
        _encodedCall: string,
        txDetails?: Truffle.TransactionDetails
      ): Promise<void>;
      sendTransaction(
        _encodedCall: string,
        txDetails?: Truffle.TransactionDetails
      ): Promise<string>;
      estimateGas(
        _encodedCall: string,
        txDetails?: Truffle.TransactionDetails
      ): Promise<number>;
    };

    executeGovernanceCall: {
      (_encodedCall: string, txDetails?: Truffle.TransactionDetails): Promise<
        Truffle.TransactionResponse<AllEvents>
      >;
      call(
        _encodedCall: string,
        txDetails?: Truffle.TransactionDetails
      ): Promise<void>;
      sendTransaction(
        _encodedCall: string,
        txDetails?: Truffle.TransactionDetails
      ): Promise<string>;
      estimateGas(
        _encodedCall: string,
        txDetails?: Truffle.TransactionDetails
      ): Promise<number>;
    };

    governance(txDetails?: Truffle.TransactionDetails): Promise<string>;

    governanceSettings(txDetails?: Truffle.TransactionDetails): Promise<string>;

    isExecutor(
      _address: string,
      txDetails?: Truffle.TransactionDetails
    ): Promise<boolean>;

    productionMode(txDetails?: Truffle.TransactionDetails): Promise<boolean>;

    switchToProductionMode: {
      (txDetails?: Truffle.TransactionDetails): Promise<
        Truffle.TransactionResponse<AllEvents>
      >;
      call(txDetails?: Truffle.TransactionDetails): Promise<void>;
      sendTransaction(txDetails?: Truffle.TransactionDetails): Promise<string>;
      estimateGas(txDetails?: Truffle.TransactionDetails): Promise<number>;
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
