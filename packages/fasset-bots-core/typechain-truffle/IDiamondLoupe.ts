/* Autogenerated file. Do not edit manually. */
/* tslint:disable */
/* eslint-disable */

import type { Truffle } from "./types";

import BN from "bn.js";
import { EventData, PastEventOptions } from "web3-eth-contract";

export interface IDiamondLoupeContract
  extends Truffle.Contract<IDiamondLoupeInstance> {
  "new"(meta?: Truffle.TransactionDetails): Promise<IDiamondLoupeInstance>;
}

export type AllEvents = never;

export interface IDiamondLoupeInstance extends Truffle.ContractInstance {
  facetAddress(
    _functionSelector: string,
    txDetails?: Truffle.TransactionDetails
  ): Promise<string>;

  facetAddresses(txDetails?: Truffle.TransactionDetails): Promise<string[]>;

  facetFunctionSelectors(
    _facet: string,
    txDetails?: Truffle.TransactionDetails
  ): Promise<string[]>;

  facets(
    txDetails?: Truffle.TransactionDetails
  ): Promise<{ facetAddress: string; functionSelectors: string[] }[]>;

  methods: {
    facetAddress(
      _functionSelector: string,
      txDetails?: Truffle.TransactionDetails
    ): Promise<string>;

    facetAddresses(txDetails?: Truffle.TransactionDetails): Promise<string[]>;

    facetFunctionSelectors(
      _facet: string,
      txDetails?: Truffle.TransactionDetails
    ): Promise<string[]>;

    facets(
      txDetails?: Truffle.TransactionDetails
    ): Promise<{ facetAddress: string; functionSelectors: string[] }[]>;
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
