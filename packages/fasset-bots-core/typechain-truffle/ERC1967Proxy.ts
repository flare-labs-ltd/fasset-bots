/* Autogenerated file. Do not edit manually. */
/* tslint:disable */
/* eslint-disable */

import type { Truffle } from "./types";

import BN from "bn.js";
import { EventData, PastEventOptions } from "web3-eth-contract";

export interface ERC1967ProxyContract
  extends Truffle.Contract<ERC1967ProxyInstance> {
  "new"(
    _logic: string,
    _data: string,
    meta?: Truffle.TransactionDetails
  ): Promise<ERC1967ProxyInstance>;
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

export interface ERC1967ProxyInstance extends Truffle.ContractInstance {
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
