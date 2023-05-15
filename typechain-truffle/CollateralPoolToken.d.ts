/* Autogenerated file. Do not edit manually. */
/* tslint:disable */
/* eslint-disable */

import BN from "bn.js";
import { EventData, PastEventOptions } from "web3-eth-contract";

export interface CollateralPoolTokenContract
  extends Truffle.Contract<CollateralPoolTokenInstance> {
  "new"(
    _collateralPool: string,
    meta?: Truffle.TransactionDetails
  ): Promise<CollateralPoolTokenInstance>;
}

export interface Approval {
  name: "Approval";
  args: {
    owner: string;
    spender: string;
    value: BN;
    0: string;
    1: string;
    2: BN;
  };
}

export interface Transfer {
  name: "Transfer";
  args: {
    from: string;
    to: string;
    value: BN;
    0: string;
    1: string;
    2: BN;
  };
}

type AllEvents = Approval | Transfer;

export interface CollateralPoolTokenInstance extends Truffle.ContractInstance {
  allowance(
    owner: string,
    spender: string,
    txDetails?: Truffle.TransactionDetails
  ): Promise<BN>;

  approve: {
    (
      spender: string,
      amount: number | BN | string,
      txDetails?: Truffle.TransactionDetails
    ): Promise<Truffle.TransactionResponse<AllEvents>>;
    call(
      spender: string,
      amount: number | BN | string,
      txDetails?: Truffle.TransactionDetails
    ): Promise<boolean>;
    sendTransaction(
      spender: string,
      amount: number | BN | string,
      txDetails?: Truffle.TransactionDetails
    ): Promise<string>;
    estimateGas(
      spender: string,
      amount: number | BN | string,
      txDetails?: Truffle.TransactionDetails
    ): Promise<number>;
  };

  balanceOf(
    account: string,
    txDetails?: Truffle.TransactionDetails
  ): Promise<BN>;

  burn: {
    (
      _account: string,
      _amount: number | BN | string,
      txDetails?: Truffle.TransactionDetails
    ): Promise<Truffle.TransactionResponse<AllEvents>>;
    call(
      _account: string,
      _amount: number | BN | string,
      txDetails?: Truffle.TransactionDetails
    ): Promise<void>;
    sendTransaction(
      _account: string,
      _amount: number | BN | string,
      txDetails?: Truffle.TransactionDetails
    ): Promise<string>;
    estimateGas(
      _account: string,
      _amount: number | BN | string,
      txDetails?: Truffle.TransactionDetails
    ): Promise<number>;
  };

  collateralPool(txDetails?: Truffle.TransactionDetails): Promise<string>;

  decimals(txDetails?: Truffle.TransactionDetails): Promise<BN>;

  decreaseAllowance: {
    (
      spender: string,
      subtractedValue: number | BN | string,
      txDetails?: Truffle.TransactionDetails
    ): Promise<Truffle.TransactionResponse<AllEvents>>;
    call(
      spender: string,
      subtractedValue: number | BN | string,
      txDetails?: Truffle.TransactionDetails
    ): Promise<boolean>;
    sendTransaction(
      spender: string,
      subtractedValue: number | BN | string,
      txDetails?: Truffle.TransactionDetails
    ): Promise<string>;
    estimateGas(
      spender: string,
      subtractedValue: number | BN | string,
      txDetails?: Truffle.TransactionDetails
    ): Promise<number>;
  };

  destroy: {
    (_recipient: string, txDetails?: Truffle.TransactionDetails): Promise<
      Truffle.TransactionResponse<AllEvents>
    >;
    call(
      _recipient: string,
      txDetails?: Truffle.TransactionDetails
    ): Promise<void>;
    sendTransaction(
      _recipient: string,
      txDetails?: Truffle.TransactionDetails
    ): Promise<string>;
    estimateGas(
      _recipient: string,
      txDetails?: Truffle.TransactionDetails
    ): Promise<number>;
  };

  increaseAllowance: {
    (
      spender: string,
      addedValue: number | BN | string,
      txDetails?: Truffle.TransactionDetails
    ): Promise<Truffle.TransactionResponse<AllEvents>>;
    call(
      spender: string,
      addedValue: number | BN | string,
      txDetails?: Truffle.TransactionDetails
    ): Promise<boolean>;
    sendTransaction(
      spender: string,
      addedValue: number | BN | string,
      txDetails?: Truffle.TransactionDetails
    ): Promise<string>;
    estimateGas(
      spender: string,
      addedValue: number | BN | string,
      txDetails?: Truffle.TransactionDetails
    ): Promise<number>;
  };

  lockedBalanceOf(
    _account: string,
    txDetails?: Truffle.TransactionDetails
  ): Promise<BN>;

  mint: {
    (
      _account: string,
      _amount: number | BN | string,
      txDetails?: Truffle.TransactionDetails
    ): Promise<Truffle.TransactionResponse<AllEvents>>;
    call(
      _account: string,
      _amount: number | BN | string,
      txDetails?: Truffle.TransactionDetails
    ): Promise<void>;
    sendTransaction(
      _account: string,
      _amount: number | BN | string,
      txDetails?: Truffle.TransactionDetails
    ): Promise<string>;
    estimateGas(
      _account: string,
      _amount: number | BN | string,
      txDetails?: Truffle.TransactionDetails
    ): Promise<number>;
  };

  name(txDetails?: Truffle.TransactionDetails): Promise<string>;

  symbol(txDetails?: Truffle.TransactionDetails): Promise<string>;

  totalSupply(txDetails?: Truffle.TransactionDetails): Promise<BN>;

  transfer: {
    (
      recipient: string,
      amount: number | BN | string,
      txDetails?: Truffle.TransactionDetails
    ): Promise<Truffle.TransactionResponse<AllEvents>>;
    call(
      recipient: string,
      amount: number | BN | string,
      txDetails?: Truffle.TransactionDetails
    ): Promise<boolean>;
    sendTransaction(
      recipient: string,
      amount: number | BN | string,
      txDetails?: Truffle.TransactionDetails
    ): Promise<string>;
    estimateGas(
      recipient: string,
      amount: number | BN | string,
      txDetails?: Truffle.TransactionDetails
    ): Promise<number>;
  };

  transferFrom: {
    (
      sender: string,
      recipient: string,
      amount: number | BN | string,
      txDetails?: Truffle.TransactionDetails
    ): Promise<Truffle.TransactionResponse<AllEvents>>;
    call(
      sender: string,
      recipient: string,
      amount: number | BN | string,
      txDetails?: Truffle.TransactionDetails
    ): Promise<boolean>;
    sendTransaction(
      sender: string,
      recipient: string,
      amount: number | BN | string,
      txDetails?: Truffle.TransactionDetails
    ): Promise<string>;
    estimateGas(
      sender: string,
      recipient: string,
      amount: number | BN | string,
      txDetails?: Truffle.TransactionDetails
    ): Promise<number>;
  };

  transferableBalanceOf(
    _account: string,
    txDetails?: Truffle.TransactionDetails
  ): Promise<BN>;

  methods: {
    allowance(
      owner: string,
      spender: string,
      txDetails?: Truffle.TransactionDetails
    ): Promise<BN>;

    approve: {
      (
        spender: string,
        amount: number | BN | string,
        txDetails?: Truffle.TransactionDetails
      ): Promise<Truffle.TransactionResponse<AllEvents>>;
      call(
        spender: string,
        amount: number | BN | string,
        txDetails?: Truffle.TransactionDetails
      ): Promise<boolean>;
      sendTransaction(
        spender: string,
        amount: number | BN | string,
        txDetails?: Truffle.TransactionDetails
      ): Promise<string>;
      estimateGas(
        spender: string,
        amount: number | BN | string,
        txDetails?: Truffle.TransactionDetails
      ): Promise<number>;
    };

    balanceOf(
      account: string,
      txDetails?: Truffle.TransactionDetails
    ): Promise<BN>;

    burn: {
      (
        _account: string,
        _amount: number | BN | string,
        txDetails?: Truffle.TransactionDetails
      ): Promise<Truffle.TransactionResponse<AllEvents>>;
      call(
        _account: string,
        _amount: number | BN | string,
        txDetails?: Truffle.TransactionDetails
      ): Promise<void>;
      sendTransaction(
        _account: string,
        _amount: number | BN | string,
        txDetails?: Truffle.TransactionDetails
      ): Promise<string>;
      estimateGas(
        _account: string,
        _amount: number | BN | string,
        txDetails?: Truffle.TransactionDetails
      ): Promise<number>;
    };

    collateralPool(txDetails?: Truffle.TransactionDetails): Promise<string>;

    decimals(txDetails?: Truffle.TransactionDetails): Promise<BN>;

    decreaseAllowance: {
      (
        spender: string,
        subtractedValue: number | BN | string,
        txDetails?: Truffle.TransactionDetails
      ): Promise<Truffle.TransactionResponse<AllEvents>>;
      call(
        spender: string,
        subtractedValue: number | BN | string,
        txDetails?: Truffle.TransactionDetails
      ): Promise<boolean>;
      sendTransaction(
        spender: string,
        subtractedValue: number | BN | string,
        txDetails?: Truffle.TransactionDetails
      ): Promise<string>;
      estimateGas(
        spender: string,
        subtractedValue: number | BN | string,
        txDetails?: Truffle.TransactionDetails
      ): Promise<number>;
    };

    destroy: {
      (_recipient: string, txDetails?: Truffle.TransactionDetails): Promise<
        Truffle.TransactionResponse<AllEvents>
      >;
      call(
        _recipient: string,
        txDetails?: Truffle.TransactionDetails
      ): Promise<void>;
      sendTransaction(
        _recipient: string,
        txDetails?: Truffle.TransactionDetails
      ): Promise<string>;
      estimateGas(
        _recipient: string,
        txDetails?: Truffle.TransactionDetails
      ): Promise<number>;
    };

    increaseAllowance: {
      (
        spender: string,
        addedValue: number | BN | string,
        txDetails?: Truffle.TransactionDetails
      ): Promise<Truffle.TransactionResponse<AllEvents>>;
      call(
        spender: string,
        addedValue: number | BN | string,
        txDetails?: Truffle.TransactionDetails
      ): Promise<boolean>;
      sendTransaction(
        spender: string,
        addedValue: number | BN | string,
        txDetails?: Truffle.TransactionDetails
      ): Promise<string>;
      estimateGas(
        spender: string,
        addedValue: number | BN | string,
        txDetails?: Truffle.TransactionDetails
      ): Promise<number>;
    };

    lockedBalanceOf(
      _account: string,
      txDetails?: Truffle.TransactionDetails
    ): Promise<BN>;

    mint: {
      (
        _account: string,
        _amount: number | BN | string,
        txDetails?: Truffle.TransactionDetails
      ): Promise<Truffle.TransactionResponse<AllEvents>>;
      call(
        _account: string,
        _amount: number | BN | string,
        txDetails?: Truffle.TransactionDetails
      ): Promise<void>;
      sendTransaction(
        _account: string,
        _amount: number | BN | string,
        txDetails?: Truffle.TransactionDetails
      ): Promise<string>;
      estimateGas(
        _account: string,
        _amount: number | BN | string,
        txDetails?: Truffle.TransactionDetails
      ): Promise<number>;
    };

    name(txDetails?: Truffle.TransactionDetails): Promise<string>;

    symbol(txDetails?: Truffle.TransactionDetails): Promise<string>;

    totalSupply(txDetails?: Truffle.TransactionDetails): Promise<BN>;

    transfer: {
      (
        recipient: string,
        amount: number | BN | string,
        txDetails?: Truffle.TransactionDetails
      ): Promise<Truffle.TransactionResponse<AllEvents>>;
      call(
        recipient: string,
        amount: number | BN | string,
        txDetails?: Truffle.TransactionDetails
      ): Promise<boolean>;
      sendTransaction(
        recipient: string,
        amount: number | BN | string,
        txDetails?: Truffle.TransactionDetails
      ): Promise<string>;
      estimateGas(
        recipient: string,
        amount: number | BN | string,
        txDetails?: Truffle.TransactionDetails
      ): Promise<number>;
    };

    transferFrom: {
      (
        sender: string,
        recipient: string,
        amount: number | BN | string,
        txDetails?: Truffle.TransactionDetails
      ): Promise<Truffle.TransactionResponse<AllEvents>>;
      call(
        sender: string,
        recipient: string,
        amount: number | BN | string,
        txDetails?: Truffle.TransactionDetails
      ): Promise<boolean>;
      sendTransaction(
        sender: string,
        recipient: string,
        amount: number | BN | string,
        txDetails?: Truffle.TransactionDetails
      ): Promise<string>;
      estimateGas(
        sender: string,
        recipient: string,
        amount: number | BN | string,
        txDetails?: Truffle.TransactionDetails
      ): Promise<number>;
    };

    transferableBalanceOf(
      _account: string,
      txDetails?: Truffle.TransactionDetails
    ): Promise<BN>;
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
