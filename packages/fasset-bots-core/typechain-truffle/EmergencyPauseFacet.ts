/* Autogenerated file. Do not edit manually. */
/* tslint:disable */
/* eslint-disable */

import type { Truffle } from "./types";

import BN from "bn.js";
import { EventData, PastEventOptions } from "web3-eth-contract";

export interface EmergencyPauseFacetContract
  extends Truffle.Contract<EmergencyPauseFacetInstance> {
  "new"(
    meta?: Truffle.TransactionDetails
  ): Promise<EmergencyPauseFacetInstance>;
}

export interface EmergencyPauseCanceled {
  name: "EmergencyPauseCanceled";
  args: {};
}

export interface EmergencyPauseTriggered {
  name: "EmergencyPauseTriggered";
  args: {
    pausedUntil: BN;
    0: BN;
  };
}

export type AllEvents = EmergencyPauseCanceled | EmergencyPauseTriggered;

export interface EmergencyPauseFacetInstance extends Truffle.ContractInstance {
  emergencyPause: {
    (
      _byGovernance: boolean,
      _duration: number | BN | string,
      txDetails?: Truffle.TransactionDetails
    ): Promise<Truffle.TransactionResponse<AllEvents>>;
    call(
      _byGovernance: boolean,
      _duration: number | BN | string,
      txDetails?: Truffle.TransactionDetails
    ): Promise<void>;
    sendTransaction(
      _byGovernance: boolean,
      _duration: number | BN | string,
      txDetails?: Truffle.TransactionDetails
    ): Promise<string>;
    estimateGas(
      _byGovernance: boolean,
      _duration: number | BN | string,
      txDetails?: Truffle.TransactionDetails
    ): Promise<number>;
  };

  emergencyPauseDetails(
    txDetails?: Truffle.TransactionDetails
  ): Promise<{ 0: BN; 1: BN; 2: boolean }>;

  emergencyPaused(txDetails?: Truffle.TransactionDetails): Promise<boolean>;

  emergencyPausedUntil(txDetails?: Truffle.TransactionDetails): Promise<BN>;

  resetEmergencyPauseTotalDuration: {
    (txDetails?: Truffle.TransactionDetails): Promise<
      Truffle.TransactionResponse<AllEvents>
    >;
    call(txDetails?: Truffle.TransactionDetails): Promise<void>;
    sendTransaction(txDetails?: Truffle.TransactionDetails): Promise<string>;
    estimateGas(txDetails?: Truffle.TransactionDetails): Promise<number>;
  };

  methods: {
    emergencyPause: {
      (
        _byGovernance: boolean,
        _duration: number | BN | string,
        txDetails?: Truffle.TransactionDetails
      ): Promise<Truffle.TransactionResponse<AllEvents>>;
      call(
        _byGovernance: boolean,
        _duration: number | BN | string,
        txDetails?: Truffle.TransactionDetails
      ): Promise<void>;
      sendTransaction(
        _byGovernance: boolean,
        _duration: number | BN | string,
        txDetails?: Truffle.TransactionDetails
      ): Promise<string>;
      estimateGas(
        _byGovernance: boolean,
        _duration: number | BN | string,
        txDetails?: Truffle.TransactionDetails
      ): Promise<number>;
    };

    emergencyPauseDetails(
      txDetails?: Truffle.TransactionDetails
    ): Promise<{ 0: BN; 1: BN; 2: boolean }>;

    emergencyPaused(txDetails?: Truffle.TransactionDetails): Promise<boolean>;

    emergencyPausedUntil(txDetails?: Truffle.TransactionDetails): Promise<BN>;

    resetEmergencyPauseTotalDuration: {
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