/* Autogenerated file. Do not edit manually. */
/* tslint:disable */
/* eslint-disable */

import type { Truffle } from "./types";

import BN from "bn.js";
import { EventData, PastEventOptions } from "web3-eth-contract";

export interface SystemInfoFacetContract
  extends Truffle.Contract<SystemInfoFacetInstance> {
  "new"(meta?: Truffle.TransactionDetails): Promise<SystemInfoFacetInstance>;
}

export type AllEvents = never;

export interface SystemInfoFacetInstance extends Truffle.ContractInstance {
  agentRedemptionQueue(
    _agentVault: string,
    _firstRedemptionTicketId: number | BN | string,
    _pageSize: number | BN | string,
    txDetails?: Truffle.TransactionDetails
  ): Promise<{
    0: { redemptionTicketId: BN; agentVault: string; ticketValueUBA: BN }[];
    1: BN;
  }>;

  controllerAttached(txDetails?: Truffle.TransactionDetails): Promise<boolean>;

  mintingPaused(txDetails?: Truffle.TransactionDetails): Promise<boolean>;

  redemptionQueue(
    _firstRedemptionTicketId: number | BN | string,
    _pageSize: number | BN | string,
    txDetails?: Truffle.TransactionDetails
  ): Promise<{
    0: { redemptionTicketId: BN; agentVault: string; ticketValueUBA: BN }[];
    1: BN;
  }>;

  terminated(txDetails?: Truffle.TransactionDetails): Promise<boolean>;

  methods: {
    agentRedemptionQueue(
      _agentVault: string,
      _firstRedemptionTicketId: number | BN | string,
      _pageSize: number | BN | string,
      txDetails?: Truffle.TransactionDetails
    ): Promise<{
      0: { redemptionTicketId: BN; agentVault: string; ticketValueUBA: BN }[];
      1: BN;
    }>;

    controllerAttached(
      txDetails?: Truffle.TransactionDetails
    ): Promise<boolean>;

    mintingPaused(txDetails?: Truffle.TransactionDetails): Promise<boolean>;

    redemptionQueue(
      _firstRedemptionTicketId: number | BN | string,
      _pageSize: number | BN | string,
      txDetails?: Truffle.TransactionDetails
    ): Promise<{
      0: { redemptionTicketId: BN; agentVault: string; ticketValueUBA: BN }[];
      1: BN;
    }>;

    terminated(txDetails?: Truffle.TransactionDetails): Promise<boolean>;
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
