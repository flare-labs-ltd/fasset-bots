/* Autogenerated file. Do not edit manually. */
/* tslint:disable */
/* eslint-disable */

import type { Truffle } from "./types";

import BN from "bn.js";
import { EventData, PastEventOptions } from "web3-eth-contract";

export interface LiquidatorContract
  extends Truffle.Contract<LiquidatorInstance> {
  "new"(
    _flashLender: string,
    _dex: string,
    meta?: Truffle.TransactionDetails
  ): Promise<LiquidatorInstance>;
}

export type AllEvents = never;

export interface LiquidatorInstance extends Truffle.ContractInstance {
  dex(txDetails?: Truffle.TransactionDetails): Promise<string>;

  flashLender(txDetails?: Truffle.TransactionDetails): Promise<string>;

  maxSlippageToMinPrices(
    _maxSlippageBipsDex1: number | BN | string,
    _maxSlippageBipsDex2: number | BN | string,
    _agentVault: string,
    txDetails?: Truffle.TransactionDetails
  ): Promise<{ 0: BN; 1: BN; 2: BN; 3: BN }>;

  onFlashLoan: {
    (
      arg0: string,
      _token: string,
      _amount: number | BN | string,
      _fee: number | BN | string,
      _data: string,
      txDetails?: Truffle.TransactionDetails
    ): Promise<Truffle.TransactionResponse<AllEvents>>;
    call(
      arg0: string,
      _token: string,
      _amount: number | BN | string,
      _fee: number | BN | string,
      _data: string,
      txDetails?: Truffle.TransactionDetails
    ): Promise<string>;
    sendTransaction(
      arg0: string,
      _token: string,
      _amount: number | BN | string,
      _fee: number | BN | string,
      _data: string,
      txDetails?: Truffle.TransactionDetails
    ): Promise<string>;
    estimateGas(
      arg0: string,
      _token: string,
      _amount: number | BN | string,
      _fee: number | BN | string,
      _data: string,
      txDetails?: Truffle.TransactionDetails
    ): Promise<number>;
  };

  runArbitrage: {
    (
      _agentVault: string,
      _profitTo: string,
      _vaultToFAssetMinDexPriceMul: number | BN | string,
      _vaultToFAssetMinDexPriceDiv: number | BN | string,
      _poolToVaultMinDexPriceMul: number | BN | string,
      _poolToVaultMinDexPriceDiv: number | BN | string,
      _flashLender: string,
      _dex: string,
      _vaultToFAssetDexPath: string[],
      _poolToVaultDexPath: string[],
      txDetails?: Truffle.TransactionDetails
    ): Promise<Truffle.TransactionResponse<AllEvents>>;
    call(
      _agentVault: string,
      _profitTo: string,
      _vaultToFAssetMinDexPriceMul: number | BN | string,
      _vaultToFAssetMinDexPriceDiv: number | BN | string,
      _poolToVaultMinDexPriceMul: number | BN | string,
      _poolToVaultMinDexPriceDiv: number | BN | string,
      _flashLender: string,
      _dex: string,
      _vaultToFAssetDexPath: string[],
      _poolToVaultDexPath: string[],
      txDetails?: Truffle.TransactionDetails
    ): Promise<void>;
    sendTransaction(
      _agentVault: string,
      _profitTo: string,
      _vaultToFAssetMinDexPriceMul: number | BN | string,
      _vaultToFAssetMinDexPriceDiv: number | BN | string,
      _poolToVaultMinDexPriceMul: number | BN | string,
      _poolToVaultMinDexPriceDiv: number | BN | string,
      _flashLender: string,
      _dex: string,
      _vaultToFAssetDexPath: string[],
      _poolToVaultDexPath: string[],
      txDetails?: Truffle.TransactionDetails
    ): Promise<string>;
    estimateGas(
      _agentVault: string,
      _profitTo: string,
      _vaultToFAssetMinDexPriceMul: number | BN | string,
      _vaultToFAssetMinDexPriceDiv: number | BN | string,
      _poolToVaultMinDexPriceMul: number | BN | string,
      _poolToVaultMinDexPriceDiv: number | BN | string,
      _flashLender: string,
      _dex: string,
      _vaultToFAssetDexPath: string[],
      _poolToVaultDexPath: string[],
      txDetails?: Truffle.TransactionDetails
    ): Promise<number>;
  };

  methods: {
    dex(txDetails?: Truffle.TransactionDetails): Promise<string>;

    flashLender(txDetails?: Truffle.TransactionDetails): Promise<string>;

    maxSlippageToMinPrices(
      _maxSlippageBipsDex1: number | BN | string,
      _maxSlippageBipsDex2: number | BN | string,
      _agentVault: string,
      txDetails?: Truffle.TransactionDetails
    ): Promise<{ 0: BN; 1: BN; 2: BN; 3: BN }>;

    onFlashLoan: {
      (
        arg0: string,
        _token: string,
        _amount: number | BN | string,
        _fee: number | BN | string,
        _data: string,
        txDetails?: Truffle.TransactionDetails
      ): Promise<Truffle.TransactionResponse<AllEvents>>;
      call(
        arg0: string,
        _token: string,
        _amount: number | BN | string,
        _fee: number | BN | string,
        _data: string,
        txDetails?: Truffle.TransactionDetails
      ): Promise<string>;
      sendTransaction(
        arg0: string,
        _token: string,
        _amount: number | BN | string,
        _fee: number | BN | string,
        _data: string,
        txDetails?: Truffle.TransactionDetails
      ): Promise<string>;
      estimateGas(
        arg0: string,
        _token: string,
        _amount: number | BN | string,
        _fee: number | BN | string,
        _data: string,
        txDetails?: Truffle.TransactionDetails
      ): Promise<number>;
    };

    runArbitrage: {
      (
        _agentVault: string,
        _profitTo: string,
        _vaultToFAssetMinDexPriceMul: number | BN | string,
        _vaultToFAssetMinDexPriceDiv: number | BN | string,
        _poolToVaultMinDexPriceMul: number | BN | string,
        _poolToVaultMinDexPriceDiv: number | BN | string,
        _flashLender: string,
        _dex: string,
        _vaultToFAssetDexPath: string[],
        _poolToVaultDexPath: string[],
        txDetails?: Truffle.TransactionDetails
      ): Promise<Truffle.TransactionResponse<AllEvents>>;
      call(
        _agentVault: string,
        _profitTo: string,
        _vaultToFAssetMinDexPriceMul: number | BN | string,
        _vaultToFAssetMinDexPriceDiv: number | BN | string,
        _poolToVaultMinDexPriceMul: number | BN | string,
        _poolToVaultMinDexPriceDiv: number | BN | string,
        _flashLender: string,
        _dex: string,
        _vaultToFAssetDexPath: string[],
        _poolToVaultDexPath: string[],
        txDetails?: Truffle.TransactionDetails
      ): Promise<void>;
      sendTransaction(
        _agentVault: string,
        _profitTo: string,
        _vaultToFAssetMinDexPriceMul: number | BN | string,
        _vaultToFAssetMinDexPriceDiv: number | BN | string,
        _poolToVaultMinDexPriceMul: number | BN | string,
        _poolToVaultMinDexPriceDiv: number | BN | string,
        _flashLender: string,
        _dex: string,
        _vaultToFAssetDexPath: string[],
        _poolToVaultDexPath: string[],
        txDetails?: Truffle.TransactionDetails
      ): Promise<string>;
      estimateGas(
        _agentVault: string,
        _profitTo: string,
        _vaultToFAssetMinDexPriceMul: number | BN | string,
        _vaultToFAssetMinDexPriceDiv: number | BN | string,
        _poolToVaultMinDexPriceMul: number | BN | string,
        _poolToVaultMinDexPriceDiv: number | BN | string,
        _flashLender: string,
        _dex: string,
        _vaultToFAssetDexPath: string[],
        _poolToVaultDexPath: string[],
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
