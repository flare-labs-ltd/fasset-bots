/* Autogenerated file. Do not edit manually. */
/* tslint:disable */
/* eslint-disable */

import type { Truffle } from "./types";

import BN from "bn.js";
import { EventData, PastEventOptions } from "web3-eth-contract";

export interface IEnosysDexRouterContract
  extends Truffle.Contract<IEnosysDexRouterInstance> {
  "new"(meta?: Truffle.TransactionDetails): Promise<IEnosysDexRouterInstance>;
}

export type AllEvents = never;

export interface IEnosysDexRouterInstance extends Truffle.ContractInstance {
  getPairReserves(
    tokenA: string,
    tokenB: string,
    txDetails?: Truffle.TransactionDetails
  ): Promise<{ 0: BN; 1: BN }>;

  swapExactTokensForTokens: {
    (
      amountIn: number | BN | string,
      amountOutMin: number | BN | string,
      path: string[],
      to: string,
      deadline: number | BN | string,
      txDetails?: Truffle.TransactionDetails
    ): Promise<Truffle.TransactionResponse<AllEvents>>;
    call(
      amountIn: number | BN | string,
      amountOutMin: number | BN | string,
      path: string[],
      to: string,
      deadline: number | BN | string,
      txDetails?: Truffle.TransactionDetails
    ): Promise<BN[]>;
    sendTransaction(
      amountIn: number | BN | string,
      amountOutMin: number | BN | string,
      path: string[],
      to: string,
      deadline: number | BN | string,
      txDetails?: Truffle.TransactionDetails
    ): Promise<string>;
    estimateGas(
      amountIn: number | BN | string,
      amountOutMin: number | BN | string,
      path: string[],
      to: string,
      deadline: number | BN | string,
      txDetails?: Truffle.TransactionDetails
    ): Promise<number>;
  };

  methods: {
    getPairReserves(
      tokenA: string,
      tokenB: string,
      txDetails?: Truffle.TransactionDetails
    ): Promise<{ 0: BN; 1: BN }>;

    swapExactTokensForTokens: {
      (
        amountIn: number | BN | string,
        amountOutMin: number | BN | string,
        path: string[],
        to: string,
        deadline: number | BN | string,
        txDetails?: Truffle.TransactionDetails
      ): Promise<Truffle.TransactionResponse<AllEvents>>;
      call(
        amountIn: number | BN | string,
        amountOutMin: number | BN | string,
        path: string[],
        to: string,
        deadline: number | BN | string,
        txDetails?: Truffle.TransactionDetails
      ): Promise<BN[]>;
      sendTransaction(
        amountIn: number | BN | string,
        amountOutMin: number | BN | string,
        path: string[],
        to: string,
        deadline: number | BN | string,
        txDetails?: Truffle.TransactionDetails
      ): Promise<string>;
      estimateGas(
        amountIn: number | BN | string,
        amountOutMin: number | BN | string,
        path: string[],
        to: string,
        deadline: number | BN | string,
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
