/* Autogenerated file. Do not edit manually. */
/* tslint:disable */
/* eslint-disable */

import type { Truffle } from "./types";

import BN from "bn.js";
import { EventData, PastEventOptions } from "web3-eth-contract";

export interface AgentPingFacetContract
  extends Truffle.Contract<AgentPingFacetInstance> {
  "new"(meta?: Truffle.TransactionDetails): Promise<AgentPingFacetInstance>;
}

export interface AgentPing {
  name: "AgentPing";
  args: {
    agentVault: string;
    sender: string;
    query: BN;
    0: string;
    1: string;
    2: BN;
  };
}

export interface AgentPingResponse {
  name: "AgentPingResponse";
  args: {
    agentVault: string;
    owner: string;
    query: BN;
    response: string;
    0: string;
    1: string;
    2: BN;
    3: string;
  };
}

export type AllEvents = AgentPing | AgentPingResponse;

export interface AgentPingFacetInstance extends Truffle.ContractInstance {
  agentPing: {
    (
      _agentVault: string,
      _query: number | BN | string,
      txDetails?: Truffle.TransactionDetails
    ): Promise<Truffle.TransactionResponse<AllEvents>>;
    call(
      _agentVault: string,
      _query: number | BN | string,
      txDetails?: Truffle.TransactionDetails
    ): Promise<void>;
    sendTransaction(
      _agentVault: string,
      _query: number | BN | string,
      txDetails?: Truffle.TransactionDetails
    ): Promise<string>;
    estimateGas(
      _agentVault: string,
      _query: number | BN | string,
      txDetails?: Truffle.TransactionDetails
    ): Promise<number>;
  };

  agentPingResponse: {
    (
      _agentVault: string,
      _query: number | BN | string,
      _response: string,
      txDetails?: Truffle.TransactionDetails
    ): Promise<Truffle.TransactionResponse<AllEvents>>;
    call(
      _agentVault: string,
      _query: number | BN | string,
      _response: string,
      txDetails?: Truffle.TransactionDetails
    ): Promise<void>;
    sendTransaction(
      _agentVault: string,
      _query: number | BN | string,
      _response: string,
      txDetails?: Truffle.TransactionDetails
    ): Promise<string>;
    estimateGas(
      _agentVault: string,
      _query: number | BN | string,
      _response: string,
      txDetails?: Truffle.TransactionDetails
    ): Promise<number>;
  };

  methods: {
    agentPing: {
      (
        _agentVault: string,
        _query: number | BN | string,
        txDetails?: Truffle.TransactionDetails
      ): Promise<Truffle.TransactionResponse<AllEvents>>;
      call(
        _agentVault: string,
        _query: number | BN | string,
        txDetails?: Truffle.TransactionDetails
      ): Promise<void>;
      sendTransaction(
        _agentVault: string,
        _query: number | BN | string,
        txDetails?: Truffle.TransactionDetails
      ): Promise<string>;
      estimateGas(
        _agentVault: string,
        _query: number | BN | string,
        txDetails?: Truffle.TransactionDetails
      ): Promise<number>;
    };

    agentPingResponse: {
      (
        _agentVault: string,
        _query: number | BN | string,
        _response: string,
        txDetails?: Truffle.TransactionDetails
      ): Promise<Truffle.TransactionResponse<AllEvents>>;
      call(
        _agentVault: string,
        _query: number | BN | string,
        _response: string,
        txDetails?: Truffle.TransactionDetails
      ): Promise<void>;
      sendTransaction(
        _agentVault: string,
        _query: number | BN | string,
        _response: string,
        txDetails?: Truffle.TransactionDetails
      ): Promise<string>;
      estimateGas(
        _agentVault: string,
        _query: number | BN | string,
        _response: string,
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
