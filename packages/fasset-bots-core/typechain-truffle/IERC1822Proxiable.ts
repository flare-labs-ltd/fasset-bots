/* Autogenerated file. Do not edit manually. */
/* tslint:disable */
/* eslint-disable */

import type { Truffle } from "./types";

import BN from "bn.js";
import { EventData, PastEventOptions } from "web3-eth-contract";

export interface IERC1822ProxiableContract
  extends Truffle.Contract<IERC1822ProxiableInstance> {
  "new"(meta?: Truffle.TransactionDetails): Promise<IERC1822ProxiableInstance>;
}

export type AllEvents = never;

export interface IERC1822ProxiableInstance extends Truffle.ContractInstance {
  proxiableUUID(txDetails?: Truffle.TransactionDetails): Promise<string>;

  methods: {
    proxiableUUID(txDetails?: Truffle.TransactionDetails): Promise<string>;
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