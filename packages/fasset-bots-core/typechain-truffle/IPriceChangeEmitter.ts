/* Autogenerated file. Do not edit manually. */
/* tslint:disable */
/* eslint-disable */

import type { Truffle } from "./types";

import BN from "bn.js";
import { EventData, PastEventOptions } from "web3-eth-contract";

export interface IPriceChangeEmitterContract
  extends Truffle.Contract<IPriceChangeEmitterInstance> {
  "new"(
    meta?: Truffle.TransactionDetails
  ): Promise<IPriceChangeEmitterInstance>;
}

export interface PriceEpochFinalized {
  name: "PriceEpochFinalized";
  args: {
    0: string;
    1: BN;
  };
}

export interface PricesPublished {
  name: "PricesPublished";
  args: {
    votingRoundId: BN;
    0: BN;
  };
}

export type AllEvents = PriceEpochFinalized | PricesPublished;

export interface IPriceChangeEmitterInstance extends Truffle.ContractInstance {
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
