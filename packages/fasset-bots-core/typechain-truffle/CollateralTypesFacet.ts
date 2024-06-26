/* Autogenerated file. Do not edit manually. */
/* tslint:disable */
/* eslint-disable */

import type { Truffle } from "./types";

import BN from "bn.js";
import { EventData, PastEventOptions } from "web3-eth-contract";

export interface CollateralTypesFacetContract
  extends Truffle.Contract<CollateralTypesFacetInstance> {
  "new"(
    meta?: Truffle.TransactionDetails
  ): Promise<CollateralTypesFacetInstance>;
}

export interface CollateralRatiosChanged {
  name: "CollateralRatiosChanged";
  args: {
    collateralClass: BN;
    collateralToken: string;
    minCollateralRatioBIPS: BN;
    ccbMinCollateralRatioBIPS: BN;
    safetyMinCollateralRatioBIPS: BN;
    0: BN;
    1: string;
    2: BN;
    3: BN;
    4: BN;
  };
}

export interface CollateralTypeAdded {
  name: "CollateralTypeAdded";
  args: {
    collateralClass: BN;
    token: string;
    decimals: BN;
    directPricePair: boolean;
    assetFtsoSymbol: string;
    tokenFtsoSymbol: string;
    minCollateralRatioBIPS: BN;
    ccbMinCollateralRatioBIPS: BN;
    safetyMinCollateralRatioBIPS: BN;
    0: BN;
    1: string;
    2: BN;
    3: boolean;
    4: string;
    5: string;
    6: BN;
    7: BN;
    8: BN;
  };
}

export interface CollateralTypeDeprecated {
  name: "CollateralTypeDeprecated";
  args: {
    collateralClass: BN;
    collateralToken: string;
    validUntil: BN;
    0: BN;
    1: string;
    2: BN;
  };
}

export type AllEvents =
  | CollateralRatiosChanged
  | CollateralTypeAdded
  | CollateralTypeDeprecated;

export interface CollateralTypesFacetInstance extends Truffle.ContractInstance {
  addCollateralType: {
    (
      _data: {
        collateralClass: number | BN | string;
        token: string;
        decimals: number | BN | string;
        validUntil: number | BN | string;
        directPricePair: boolean;
        assetFtsoSymbol: string;
        tokenFtsoSymbol: string;
        minCollateralRatioBIPS: number | BN | string;
        ccbMinCollateralRatioBIPS: number | BN | string;
        safetyMinCollateralRatioBIPS: number | BN | string;
      },
      txDetails?: Truffle.TransactionDetails
    ): Promise<Truffle.TransactionResponse<AllEvents>>;
    call(
      _data: {
        collateralClass: number | BN | string;
        token: string;
        decimals: number | BN | string;
        validUntil: number | BN | string;
        directPricePair: boolean;
        assetFtsoSymbol: string;
        tokenFtsoSymbol: string;
        minCollateralRatioBIPS: number | BN | string;
        ccbMinCollateralRatioBIPS: number | BN | string;
        safetyMinCollateralRatioBIPS: number | BN | string;
      },
      txDetails?: Truffle.TransactionDetails
    ): Promise<void>;
    sendTransaction(
      _data: {
        collateralClass: number | BN | string;
        token: string;
        decimals: number | BN | string;
        validUntil: number | BN | string;
        directPricePair: boolean;
        assetFtsoSymbol: string;
        tokenFtsoSymbol: string;
        minCollateralRatioBIPS: number | BN | string;
        ccbMinCollateralRatioBIPS: number | BN | string;
        safetyMinCollateralRatioBIPS: number | BN | string;
      },
      txDetails?: Truffle.TransactionDetails
    ): Promise<string>;
    estimateGas(
      _data: {
        collateralClass: number | BN | string;
        token: string;
        decimals: number | BN | string;
        validUntil: number | BN | string;
        directPricePair: boolean;
        assetFtsoSymbol: string;
        tokenFtsoSymbol: string;
        minCollateralRatioBIPS: number | BN | string;
        ccbMinCollateralRatioBIPS: number | BN | string;
        safetyMinCollateralRatioBIPS: number | BN | string;
      },
      txDetails?: Truffle.TransactionDetails
    ): Promise<number>;
  };

  deprecateCollateralType: {
    (
      _collateralClass: number | BN | string,
      _token: string,
      _invalidationTimeSec: number | BN | string,
      txDetails?: Truffle.TransactionDetails
    ): Promise<Truffle.TransactionResponse<AllEvents>>;
    call(
      _collateralClass: number | BN | string,
      _token: string,
      _invalidationTimeSec: number | BN | string,
      txDetails?: Truffle.TransactionDetails
    ): Promise<void>;
    sendTransaction(
      _collateralClass: number | BN | string,
      _token: string,
      _invalidationTimeSec: number | BN | string,
      txDetails?: Truffle.TransactionDetails
    ): Promise<string>;
    estimateGas(
      _collateralClass: number | BN | string,
      _token: string,
      _invalidationTimeSec: number | BN | string,
      txDetails?: Truffle.TransactionDetails
    ): Promise<number>;
  };

  getCollateralType(
    _collateralClass: number | BN | string,
    _token: string,
    txDetails?: Truffle.TransactionDetails
  ): Promise<{
    collateralClass: BN;
    token: string;
    decimals: BN;
    validUntil: BN;
    directPricePair: boolean;
    assetFtsoSymbol: string;
    tokenFtsoSymbol: string;
    minCollateralRatioBIPS: BN;
    ccbMinCollateralRatioBIPS: BN;
    safetyMinCollateralRatioBIPS: BN;
  }>;

  getCollateralTypes(
    txDetails?: Truffle.TransactionDetails
  ): Promise<
    {
      collateralClass: BN;
      token: string;
      decimals: BN;
      validUntil: BN;
      directPricePair: boolean;
      assetFtsoSymbol: string;
      tokenFtsoSymbol: string;
      minCollateralRatioBIPS: BN;
      ccbMinCollateralRatioBIPS: BN;
      safetyMinCollateralRatioBIPS: BN;
    }[]
  >;

  setCollateralRatiosForToken: {
    (
      _collateralClass: number | BN | string,
      _token: string,
      _minCollateralRatioBIPS: number | BN | string,
      _ccbMinCollateralRatioBIPS: number | BN | string,
      _safetyMinCollateralRatioBIPS: number | BN | string,
      txDetails?: Truffle.TransactionDetails
    ): Promise<Truffle.TransactionResponse<AllEvents>>;
    call(
      _collateralClass: number | BN | string,
      _token: string,
      _minCollateralRatioBIPS: number | BN | string,
      _ccbMinCollateralRatioBIPS: number | BN | string,
      _safetyMinCollateralRatioBIPS: number | BN | string,
      txDetails?: Truffle.TransactionDetails
    ): Promise<void>;
    sendTransaction(
      _collateralClass: number | BN | string,
      _token: string,
      _minCollateralRatioBIPS: number | BN | string,
      _ccbMinCollateralRatioBIPS: number | BN | string,
      _safetyMinCollateralRatioBIPS: number | BN | string,
      txDetails?: Truffle.TransactionDetails
    ): Promise<string>;
    estimateGas(
      _collateralClass: number | BN | string,
      _token: string,
      _minCollateralRatioBIPS: number | BN | string,
      _ccbMinCollateralRatioBIPS: number | BN | string,
      _safetyMinCollateralRatioBIPS: number | BN | string,
      txDetails?: Truffle.TransactionDetails
    ): Promise<number>;
  };

  methods: {
    addCollateralType: {
      (
        _data: {
          collateralClass: number | BN | string;
          token: string;
          decimals: number | BN | string;
          validUntil: number | BN | string;
          directPricePair: boolean;
          assetFtsoSymbol: string;
          tokenFtsoSymbol: string;
          minCollateralRatioBIPS: number | BN | string;
          ccbMinCollateralRatioBIPS: number | BN | string;
          safetyMinCollateralRatioBIPS: number | BN | string;
        },
        txDetails?: Truffle.TransactionDetails
      ): Promise<Truffle.TransactionResponse<AllEvents>>;
      call(
        _data: {
          collateralClass: number | BN | string;
          token: string;
          decimals: number | BN | string;
          validUntil: number | BN | string;
          directPricePair: boolean;
          assetFtsoSymbol: string;
          tokenFtsoSymbol: string;
          minCollateralRatioBIPS: number | BN | string;
          ccbMinCollateralRatioBIPS: number | BN | string;
          safetyMinCollateralRatioBIPS: number | BN | string;
        },
        txDetails?: Truffle.TransactionDetails
      ): Promise<void>;
      sendTransaction(
        _data: {
          collateralClass: number | BN | string;
          token: string;
          decimals: number | BN | string;
          validUntil: number | BN | string;
          directPricePair: boolean;
          assetFtsoSymbol: string;
          tokenFtsoSymbol: string;
          minCollateralRatioBIPS: number | BN | string;
          ccbMinCollateralRatioBIPS: number | BN | string;
          safetyMinCollateralRatioBIPS: number | BN | string;
        },
        txDetails?: Truffle.TransactionDetails
      ): Promise<string>;
      estimateGas(
        _data: {
          collateralClass: number | BN | string;
          token: string;
          decimals: number | BN | string;
          validUntil: number | BN | string;
          directPricePair: boolean;
          assetFtsoSymbol: string;
          tokenFtsoSymbol: string;
          minCollateralRatioBIPS: number | BN | string;
          ccbMinCollateralRatioBIPS: number | BN | string;
          safetyMinCollateralRatioBIPS: number | BN | string;
        },
        txDetails?: Truffle.TransactionDetails
      ): Promise<number>;
    };

    deprecateCollateralType: {
      (
        _collateralClass: number | BN | string,
        _token: string,
        _invalidationTimeSec: number | BN | string,
        txDetails?: Truffle.TransactionDetails
      ): Promise<Truffle.TransactionResponse<AllEvents>>;
      call(
        _collateralClass: number | BN | string,
        _token: string,
        _invalidationTimeSec: number | BN | string,
        txDetails?: Truffle.TransactionDetails
      ): Promise<void>;
      sendTransaction(
        _collateralClass: number | BN | string,
        _token: string,
        _invalidationTimeSec: number | BN | string,
        txDetails?: Truffle.TransactionDetails
      ): Promise<string>;
      estimateGas(
        _collateralClass: number | BN | string,
        _token: string,
        _invalidationTimeSec: number | BN | string,
        txDetails?: Truffle.TransactionDetails
      ): Promise<number>;
    };

    getCollateralType(
      _collateralClass: number | BN | string,
      _token: string,
      txDetails?: Truffle.TransactionDetails
    ): Promise<{
      collateralClass: BN;
      token: string;
      decimals: BN;
      validUntil: BN;
      directPricePair: boolean;
      assetFtsoSymbol: string;
      tokenFtsoSymbol: string;
      minCollateralRatioBIPS: BN;
      ccbMinCollateralRatioBIPS: BN;
      safetyMinCollateralRatioBIPS: BN;
    }>;

    getCollateralTypes(
      txDetails?: Truffle.TransactionDetails
    ): Promise<
      {
        collateralClass: BN;
        token: string;
        decimals: BN;
        validUntil: BN;
        directPricePair: boolean;
        assetFtsoSymbol: string;
        tokenFtsoSymbol: string;
        minCollateralRatioBIPS: BN;
        ccbMinCollateralRatioBIPS: BN;
        safetyMinCollateralRatioBIPS: BN;
      }[]
    >;

    setCollateralRatiosForToken: {
      (
        _collateralClass: number | BN | string,
        _token: string,
        _minCollateralRatioBIPS: number | BN | string,
        _ccbMinCollateralRatioBIPS: number | BN | string,
        _safetyMinCollateralRatioBIPS: number | BN | string,
        txDetails?: Truffle.TransactionDetails
      ): Promise<Truffle.TransactionResponse<AllEvents>>;
      call(
        _collateralClass: number | BN | string,
        _token: string,
        _minCollateralRatioBIPS: number | BN | string,
        _ccbMinCollateralRatioBIPS: number | BN | string,
        _safetyMinCollateralRatioBIPS: number | BN | string,
        txDetails?: Truffle.TransactionDetails
      ): Promise<void>;
      sendTransaction(
        _collateralClass: number | BN | string,
        _token: string,
        _minCollateralRatioBIPS: number | BN | string,
        _ccbMinCollateralRatioBIPS: number | BN | string,
        _safetyMinCollateralRatioBIPS: number | BN | string,
        txDetails?: Truffle.TransactionDetails
      ): Promise<string>;
      estimateGas(
        _collateralClass: number | BN | string,
        _token: string,
        _minCollateralRatioBIPS: number | BN | string,
        _ccbMinCollateralRatioBIPS: number | BN | string,
        _safetyMinCollateralRatioBIPS: number | BN | string,
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
