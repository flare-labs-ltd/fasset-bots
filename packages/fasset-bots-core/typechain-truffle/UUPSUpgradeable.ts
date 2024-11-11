/* Autogenerated file. Do not edit manually. */
/* tslint:disable */
/* eslint-disable */

import type { Truffle } from "./types";

import BN from "bn.js";
import { EventData, PastEventOptions } from "web3-eth-contract";

export interface UUPSUpgradeableContract
  extends Truffle.Contract<UUPSUpgradeableInstance> {
  "new"(meta?: Truffle.TransactionDetails): Promise<UUPSUpgradeableInstance>;
}

export interface AdminChanged {
  name: "AdminChanged";
  args: {
    previousAdmin: string;
    newAdmin: string;
    0: string;
    1: string;
  };
}

export interface BeaconUpgraded {
  name: "BeaconUpgraded";
  args: {
    beacon: string;
    0: string;
  };
}

export interface Upgraded {
  name: "Upgraded";
  args: {
    implementation: string;
    0: string;
  };
}

export type AllEvents = AdminChanged | BeaconUpgraded | Upgraded;

export interface UUPSUpgradeableInstance extends Truffle.ContractInstance {
  proxiableUUID(txDetails?: Truffle.TransactionDetails): Promise<string>;

  upgradeTo: {
    (
      newImplementation: string,
      txDetails?: Truffle.TransactionDetails
    ): Promise<Truffle.TransactionResponse<AllEvents>>;
    call(
      newImplementation: string,
      txDetails?: Truffle.TransactionDetails
    ): Promise<void>;
    sendTransaction(
      newImplementation: string,
      txDetails?: Truffle.TransactionDetails
    ): Promise<string>;
    estimateGas(
      newImplementation: string,
      txDetails?: Truffle.TransactionDetails
    ): Promise<number>;
  };

  upgradeToAndCall: {
    (
      newImplementation: string,
      data: string,
      txDetails?: Truffle.TransactionDetails
    ): Promise<Truffle.TransactionResponse<AllEvents>>;
    call(
      newImplementation: string,
      data: string,
      txDetails?: Truffle.TransactionDetails
    ): Promise<void>;
    sendTransaction(
      newImplementation: string,
      data: string,
      txDetails?: Truffle.TransactionDetails
    ): Promise<string>;
    estimateGas(
      newImplementation: string,
      data: string,
      txDetails?: Truffle.TransactionDetails
    ): Promise<number>;
  };

  methods: {
    proxiableUUID(txDetails?: Truffle.TransactionDetails): Promise<string>;

    upgradeTo: {
      (
        newImplementation: string,
        txDetails?: Truffle.TransactionDetails
      ): Promise<Truffle.TransactionResponse<AllEvents>>;
      call(
        newImplementation: string,
        txDetails?: Truffle.TransactionDetails
      ): Promise<void>;
      sendTransaction(
        newImplementation: string,
        txDetails?: Truffle.TransactionDetails
      ): Promise<string>;
      estimateGas(
        newImplementation: string,
        txDetails?: Truffle.TransactionDetails
      ): Promise<number>;
    };

    upgradeToAndCall: {
      (
        newImplementation: string,
        data: string,
        txDetails?: Truffle.TransactionDetails
      ): Promise<Truffle.TransactionResponse<AllEvents>>;
      call(
        newImplementation: string,
        data: string,
        txDetails?: Truffle.TransactionDetails
      ): Promise<void>;
      sendTransaction(
        newImplementation: string,
        data: string,
        txDetails?: Truffle.TransactionDetails
      ): Promise<string>;
      estimateGas(
        newImplementation: string,
        data: string,
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