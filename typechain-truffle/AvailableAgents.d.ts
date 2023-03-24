/* Autogenerated file. Do not edit manually. */
/* tslint:disable */
/* eslint-disable */

import BN from "bn.js";
import { EventData, PastEventOptions } from "web3-eth-contract";

export interface AvailableAgentsContract
  extends Truffle.Contract<AvailableAgentsInstance> {
  "new"(meta?: Truffle.TransactionDetails): Promise<AvailableAgentsInstance>;
}

type AllEvents = never;

export interface AvailableAgentsInstance extends Truffle.ContractInstance {
  getList(
    _start: number | BN | string,
    _end: number | BN | string,
    txDetails?: Truffle.TransactionDetails
  ): Promise<{ 0: string[]; 1: BN }>;

  getListWithInfo(
    _start: number | BN | string,
    _end: number | BN | string,
    txDetails?: Truffle.TransactionDetails
  ): Promise<{
    0: {
      agentVault: string;
      feeBIPS: BN;
      mintingClass1CollateralRatioBIPS: BN;
      mintingPoolCollateralRatioBIPS: BN;
      freeCollateralLots: BN;
    }[];
    1: BN;
  }>;

  methods: {
    getList(
      _start: number | BN | string,
      _end: number | BN | string,
      txDetails?: Truffle.TransactionDetails
    ): Promise<{ 0: string[]; 1: BN }>;

    getListWithInfo(
      _start: number | BN | string,
      _end: number | BN | string,
      txDetails?: Truffle.TransactionDetails
    ): Promise<{
      0: {
        agentVault: string;
        feeBIPS: BN;
        mintingClass1CollateralRatioBIPS: BN;
        mintingPoolCollateralRatioBIPS: BN;
        freeCollateralLots: BN;
      }[];
      1: BN;
    }>;
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
