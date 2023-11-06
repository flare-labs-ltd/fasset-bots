/* Autogenerated file. Do not edit manually. */
/* tslint:disable */
/* eslint-disable */

import BN from "bn.js";
import { EventData, PastEventOptions } from "web3-eth-contract";

export interface FlashLenderContract
  extends Truffle.Contract<FlashLenderInstance> {
  "new"(
    _token: string,
    meta?: Truffle.TransactionDetails
  ): Promise<FlashLenderInstance>;
}

export interface OwnershipTransferred {
  name: "OwnershipTransferred";
  args: {
    previousOwner: string;
    newOwner: string;
    0: string;
    1: string;
  };
}

type AllEvents = OwnershipTransferred;

export interface FlashLenderInstance extends Truffle.ContractInstance {
  flashFee(
    _token: string,
    arg1: number | BN | string,
    txDetails?: Truffle.TransactionDetails
  ): Promise<BN>;

  flashFeeReceiver(
    _token: string,
    txDetails?: Truffle.TransactionDetails
  ): Promise<string>;

  flashLoan: {
    (
      _receiver: string,
      _token: string,
      _amount: number | BN | string,
      _data: string,
      txDetails?: Truffle.TransactionDetails
    ): Promise<Truffle.TransactionResponse<AllEvents>>;
    call(
      _receiver: string,
      _token: string,
      _amount: number | BN | string,
      _data: string,
      txDetails?: Truffle.TransactionDetails
    ): Promise<boolean>;
    sendTransaction(
      _receiver: string,
      _token: string,
      _amount: number | BN | string,
      _data: string,
      txDetails?: Truffle.TransactionDetails
    ): Promise<string>;
    estimateGas(
      _receiver: string,
      _token: string,
      _amount: number | BN | string,
      _data: string,
      txDetails?: Truffle.TransactionDetails
    ): Promise<number>;
  };

  maxFlashLoan(
    _token: string,
    txDetails?: Truffle.TransactionDetails
  ): Promise<BN>;

  owner(txDetails?: Truffle.TransactionDetails): Promise<string>;

  renounceOwnership: {
    (txDetails?: Truffle.TransactionDetails): Promise<
      Truffle.TransactionResponse<AllEvents>
    >;
    call(txDetails?: Truffle.TransactionDetails): Promise<void>;
    sendTransaction(txDetails?: Truffle.TransactionDetails): Promise<string>;
    estimateGas(txDetails?: Truffle.TransactionDetails): Promise<number>;
  };

  transferOwnership: {
    (newOwner: string, txDetails?: Truffle.TransactionDetails): Promise<
      Truffle.TransactionResponse<AllEvents>
    >;
    call(
      newOwner: string,
      txDetails?: Truffle.TransactionDetails
    ): Promise<void>;
    sendTransaction(
      newOwner: string,
      txDetails?: Truffle.TransactionDetails
    ): Promise<string>;
    estimateGas(
      newOwner: string,
      txDetails?: Truffle.TransactionDetails
    ): Promise<number>;
  };

  withdraw: {
    (txDetails?: Truffle.TransactionDetails): Promise<
      Truffle.TransactionResponse<AllEvents>
    >;
    call(txDetails?: Truffle.TransactionDetails): Promise<void>;
    sendTransaction(txDetails?: Truffle.TransactionDetails): Promise<string>;
    estimateGas(txDetails?: Truffle.TransactionDetails): Promise<number>;
  };

  methods: {
    flashFee(
      _token: string,
      arg1: number | BN | string,
      txDetails?: Truffle.TransactionDetails
    ): Promise<BN>;

    flashFeeReceiver(
      _token: string,
      txDetails?: Truffle.TransactionDetails
    ): Promise<string>;

    flashLoan: {
      (
        _receiver: string,
        _token: string,
        _amount: number | BN | string,
        _data: string,
        txDetails?: Truffle.TransactionDetails
      ): Promise<Truffle.TransactionResponse<AllEvents>>;
      call(
        _receiver: string,
        _token: string,
        _amount: number | BN | string,
        _data: string,
        txDetails?: Truffle.TransactionDetails
      ): Promise<boolean>;
      sendTransaction(
        _receiver: string,
        _token: string,
        _amount: number | BN | string,
        _data: string,
        txDetails?: Truffle.TransactionDetails
      ): Promise<string>;
      estimateGas(
        _receiver: string,
        _token: string,
        _amount: number | BN | string,
        _data: string,
        txDetails?: Truffle.TransactionDetails
      ): Promise<number>;
    };

    maxFlashLoan(
      _token: string,
      txDetails?: Truffle.TransactionDetails
    ): Promise<BN>;

    owner(txDetails?: Truffle.TransactionDetails): Promise<string>;

    renounceOwnership: {
      (txDetails?: Truffle.TransactionDetails): Promise<
        Truffle.TransactionResponse<AllEvents>
      >;
      call(txDetails?: Truffle.TransactionDetails): Promise<void>;
      sendTransaction(txDetails?: Truffle.TransactionDetails): Promise<string>;
      estimateGas(txDetails?: Truffle.TransactionDetails): Promise<number>;
    };

    transferOwnership: {
      (newOwner: string, txDetails?: Truffle.TransactionDetails): Promise<
        Truffle.TransactionResponse<AllEvents>
      >;
      call(
        newOwner: string,
        txDetails?: Truffle.TransactionDetails
      ): Promise<void>;
      sendTransaction(
        newOwner: string,
        txDetails?: Truffle.TransactionDetails
      ): Promise<string>;
      estimateGas(
        newOwner: string,
        txDetails?: Truffle.TransactionDetails
      ): Promise<number>;
    };

    withdraw: {
      (txDetails?: Truffle.TransactionDetails): Promise<
        Truffle.TransactionResponse<AllEvents>
      >;
      call(txDetails?: Truffle.TransactionDetails): Promise<void>;
      sendTransaction(txDetails?: Truffle.TransactionDetails): Promise<string>;
      estimateGas(txDetails?: Truffle.TransactionDetails): Promise<number>;
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
