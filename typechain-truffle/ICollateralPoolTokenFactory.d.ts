/* Autogenerated file. Do not edit manually. */
/* tslint:disable */
/* eslint-disable */

import BN from "bn.js";
import { EventData, PastEventOptions } from "web3-eth-contract";

export interface ICollateralPoolTokenFactoryContract
  extends Truffle.Contract<ICollateralPoolTokenFactoryInstance> {
  "new"(
    meta?: Truffle.TransactionDetails
  ): Promise<ICollateralPoolTokenFactoryInstance>;
}

type AllEvents = never;

export interface ICollateralPoolTokenFactoryInstance
  extends Truffle.ContractInstance {
  create: {
    (pool: string, txDetails?: Truffle.TransactionDetails): Promise<
      Truffle.TransactionResponse<AllEvents>
    >;
    call(pool: string, txDetails?: Truffle.TransactionDetails): Promise<string>;
    sendTransaction(
      pool: string,
      txDetails?: Truffle.TransactionDetails
    ): Promise<string>;
    estimateGas(
      pool: string,
      txDetails?: Truffle.TransactionDetails
    ): Promise<number>;
  };

  methods: {
    create: {
      (pool: string, txDetails?: Truffle.TransactionDetails): Promise<
        Truffle.TransactionResponse<AllEvents>
      >;
      call(
        pool: string,
        txDetails?: Truffle.TransactionDetails
      ): Promise<string>;
      sendTransaction(
        pool: string,
        txDetails?: Truffle.TransactionDetails
      ): Promise<string>;
      estimateGas(
        pool: string,
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
