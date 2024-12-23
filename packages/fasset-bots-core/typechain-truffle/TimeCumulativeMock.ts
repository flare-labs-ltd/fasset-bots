/* Autogenerated file. Do not edit manually. */
/* tslint:disable */
/* eslint-disable */

import type { Truffle } from "./types";

import BN from "bn.js";
import { EventData, PastEventOptions } from "web3-eth-contract";

export interface TimeCumulativeMockContract
  extends Truffle.Contract<TimeCumulativeMockInstance> {
  "new"(meta?: Truffle.TransactionDetails): Promise<TimeCumulativeMockInstance>;
}

export type AllEvents = never;

export interface TimeCumulativeMockInstance extends Truffle.ContractInstance {
  addDataPoint: {
    (
      _timestamp: number | BN | string,
      _value: number | BN | string,
      txDetails?: Truffle.TransactionDetails
    ): Promise<Truffle.TransactionResponse<AllEvents>>;
    call(
      _timestamp: number | BN | string,
      _value: number | BN | string,
      txDetails?: Truffle.TransactionDetails
    ): Promise<void>;
    sendTransaction(
      _timestamp: number | BN | string,
      _value: number | BN | string,
      txDetails?: Truffle.TransactionDetails
    ): Promise<string>;
    estimateGas(
      _timestamp: number | BN | string,
      _value: number | BN | string,
      txDetails?: Truffle.TransactionDetails
    ): Promise<number>;
  };

  binarySearch(
    _ts: number | BN | string,
    txDetails?: Truffle.TransactionDetails
  ): Promise<BN>;

  cleanup: {
    (
      _untilTimestamp: number | BN | string,
      _maxPoints: number | BN | string,
      txDetails?: Truffle.TransactionDetails
    ): Promise<Truffle.TransactionResponse<AllEvents>>;
    call(
      _untilTimestamp: number | BN | string,
      _maxPoints: number | BN | string,
      txDetails?: Truffle.TransactionDetails
    ): Promise<void>;
    sendTransaction(
      _untilTimestamp: number | BN | string,
      _maxPoints: number | BN | string,
      txDetails?: Truffle.TransactionDetails
    ): Promise<string>;
    estimateGas(
      _untilTimestamp: number | BN | string,
      _maxPoints: number | BN | string,
      txDetails?: Truffle.TransactionDetails
    ): Promise<number>;
  };

  cumulativeTo(
    _ts: number | BN | string,
    txDetails?: Truffle.TransactionDetails
  ): Promise<BN>;

  getData(
    txDetails?: Truffle.TransactionDetails
  ): Promise<{
    0: { cumulative: BN; timestamp: BN; value: BN }[];
    1: BN;
    2: BN;
  }>;

  intervalCumulative(
    _fromTs: number | BN | string,
    _toTs: number | BN | string,
    txDetails?: Truffle.TransactionDetails
  ): Promise<BN>;

  setData: {
    (
      _points: {
        cumulative: number | BN | string;
        timestamp: number | BN | string;
        value: number | BN | string;
      }[],
      _startIndex: number | BN | string,
      _endIndex: number | BN | string,
      txDetails?: Truffle.TransactionDetails
    ): Promise<Truffle.TransactionResponse<AllEvents>>;
    call(
      _points: {
        cumulative: number | BN | string;
        timestamp: number | BN | string;
        value: number | BN | string;
      }[],
      _startIndex: number | BN | string,
      _endIndex: number | BN | string,
      txDetails?: Truffle.TransactionDetails
    ): Promise<void>;
    sendTransaction(
      _points: {
        cumulative: number | BN | string;
        timestamp: number | BN | string;
        value: number | BN | string;
      }[],
      _startIndex: number | BN | string,
      _endIndex: number | BN | string,
      txDetails?: Truffle.TransactionDetails
    ): Promise<string>;
    estimateGas(
      _points: {
        cumulative: number | BN | string;
        timestamp: number | BN | string;
        value: number | BN | string;
      }[],
      _startIndex: number | BN | string,
      _endIndex: number | BN | string,
      txDetails?: Truffle.TransactionDetails
    ): Promise<number>;
  };

  methods: {
    addDataPoint: {
      (
        _timestamp: number | BN | string,
        _value: number | BN | string,
        txDetails?: Truffle.TransactionDetails
      ): Promise<Truffle.TransactionResponse<AllEvents>>;
      call(
        _timestamp: number | BN | string,
        _value: number | BN | string,
        txDetails?: Truffle.TransactionDetails
      ): Promise<void>;
      sendTransaction(
        _timestamp: number | BN | string,
        _value: number | BN | string,
        txDetails?: Truffle.TransactionDetails
      ): Promise<string>;
      estimateGas(
        _timestamp: number | BN | string,
        _value: number | BN | string,
        txDetails?: Truffle.TransactionDetails
      ): Promise<number>;
    };

    binarySearch(
      _ts: number | BN | string,
      txDetails?: Truffle.TransactionDetails
    ): Promise<BN>;

    cleanup: {
      (
        _untilTimestamp: number | BN | string,
        _maxPoints: number | BN | string,
        txDetails?: Truffle.TransactionDetails
      ): Promise<Truffle.TransactionResponse<AllEvents>>;
      call(
        _untilTimestamp: number | BN | string,
        _maxPoints: number | BN | string,
        txDetails?: Truffle.TransactionDetails
      ): Promise<void>;
      sendTransaction(
        _untilTimestamp: number | BN | string,
        _maxPoints: number | BN | string,
        txDetails?: Truffle.TransactionDetails
      ): Promise<string>;
      estimateGas(
        _untilTimestamp: number | BN | string,
        _maxPoints: number | BN | string,
        txDetails?: Truffle.TransactionDetails
      ): Promise<number>;
    };

    cumulativeTo(
      _ts: number | BN | string,
      txDetails?: Truffle.TransactionDetails
    ): Promise<BN>;

    getData(
      txDetails?: Truffle.TransactionDetails
    ): Promise<{
      0: { cumulative: BN; timestamp: BN; value: BN }[];
      1: BN;
      2: BN;
    }>;

    intervalCumulative(
      _fromTs: number | BN | string,
      _toTs: number | BN | string,
      txDetails?: Truffle.TransactionDetails
    ): Promise<BN>;

    setData: {
      (
        _points: {
          cumulative: number | BN | string;
          timestamp: number | BN | string;
          value: number | BN | string;
        }[],
        _startIndex: number | BN | string,
        _endIndex: number | BN | string,
        txDetails?: Truffle.TransactionDetails
      ): Promise<Truffle.TransactionResponse<AllEvents>>;
      call(
        _points: {
          cumulative: number | BN | string;
          timestamp: number | BN | string;
          value: number | BN | string;
        }[],
        _startIndex: number | BN | string,
        _endIndex: number | BN | string,
        txDetails?: Truffle.TransactionDetails
      ): Promise<void>;
      sendTransaction(
        _points: {
          cumulative: number | BN | string;
          timestamp: number | BN | string;
          value: number | BN | string;
        }[],
        _startIndex: number | BN | string,
        _endIndex: number | BN | string,
        txDetails?: Truffle.TransactionDetails
      ): Promise<string>;
      estimateGas(
        _points: {
          cumulative: number | BN | string;
          timestamp: number | BN | string;
          value: number | BN | string;
        }[],
        _startIndex: number | BN | string,
        _endIndex: number | BN | string,
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
