/* Autogenerated file. Do not edit manually. */
/* tslint:disable */
/* eslint-disable */

import type { Truffle } from "./types";

import BN from "bn.js";
import { EventData, PastEventOptions } from "web3-eth-contract";

export interface IDiamondCutContract
  extends Truffle.Contract<IDiamondCutInstance> {
  "new"(meta?: Truffle.TransactionDetails): Promise<IDiamondCutInstance>;
}

export interface DiamondCut {
  name: "DiamondCut";
  args: {
    _diamondCut: {
      facetAddress: string;
      action: BN;
      functionSelectors: string[];
    }[];
    _init: string;
    _calldata: string;
    0: { facetAddress: string; action: BN; functionSelectors: string[] }[];
    1: string;
    2: string;
  };
}

export type AllEvents = DiamondCut;

export interface IDiamondCutInstance extends Truffle.ContractInstance {
  diamondCut: {
    (
      _diamondCut: {
        facetAddress: string;
        action: number | BN | string;
        functionSelectors: string[];
      }[],
      _init: string,
      _calldata: string,
      txDetails?: Truffle.TransactionDetails
    ): Promise<Truffle.TransactionResponse<AllEvents>>;
    call(
      _diamondCut: {
        facetAddress: string;
        action: number | BN | string;
        functionSelectors: string[];
      }[],
      _init: string,
      _calldata: string,
      txDetails?: Truffle.TransactionDetails
    ): Promise<void>;
    sendTransaction(
      _diamondCut: {
        facetAddress: string;
        action: number | BN | string;
        functionSelectors: string[];
      }[],
      _init: string,
      _calldata: string,
      txDetails?: Truffle.TransactionDetails
    ): Promise<string>;
    estimateGas(
      _diamondCut: {
        facetAddress: string;
        action: number | BN | string;
        functionSelectors: string[];
      }[],
      _init: string,
      _calldata: string,
      txDetails?: Truffle.TransactionDetails
    ): Promise<number>;
  };

  methods: {
    diamondCut: {
      (
        _diamondCut: {
          facetAddress: string;
          action: number | BN | string;
          functionSelectors: string[];
        }[],
        _init: string,
        _calldata: string,
        txDetails?: Truffle.TransactionDetails
      ): Promise<Truffle.TransactionResponse<AllEvents>>;
      call(
        _diamondCut: {
          facetAddress: string;
          action: number | BN | string;
          functionSelectors: string[];
        }[],
        _init: string,
        _calldata: string,
        txDetails?: Truffle.TransactionDetails
      ): Promise<void>;
      sendTransaction(
        _diamondCut: {
          facetAddress: string;
          action: number | BN | string;
          functionSelectors: string[];
        }[],
        _init: string,
        _calldata: string,
        txDetails?: Truffle.TransactionDetails
      ): Promise<string>;
      estimateGas(
        _diamondCut: {
          facetAddress: string;
          action: number | BN | string;
          functionSelectors: string[];
        }[],
        _init: string,
        _calldata: string,
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
