/* Autogenerated file. Do not edit manually. */
/* tslint:disable */
/* eslint-disable */

import BN from "bn.js";
import { EventData, PastEventOptions } from "web3-eth-contract";

export interface CollateralPoolFactoryContract
  extends Truffle.Contract<CollateralPoolFactoryInstance> {
  "new"(
    meta?: Truffle.TransactionDetails
  ): Promise<CollateralPoolFactoryInstance>;
}

type AllEvents = never;

export interface CollateralPoolFactoryInstance
  extends Truffle.ContractInstance {
  create: {
    (
      _assetManager: string,
      _agentVault: string,
      _settings: {
        underlyingAddressString: string;
        vaultCollateralToken: string;
        poolTokenSuffix: string;
        feeBIPS: number | BN | string;
        poolFeeShareBIPS: number | BN | string;
        mintingVaultCollateralRatioBIPS: number | BN | string;
        mintingPoolCollateralRatioBIPS: number | BN | string;
        buyFAssetByAgentFactorBIPS: number | BN | string;
        poolExitCollateralRatioBIPS: number | BN | string;
        poolTopupCollateralRatioBIPS: number | BN | string;
        poolTopupTokenPriceFactorBIPS: number | BN | string;
      },
      txDetails?: Truffle.TransactionDetails
    ): Promise<Truffle.TransactionResponse<AllEvents>>;
    call(
      _assetManager: string,
      _agentVault: string,
      _settings: {
        underlyingAddressString: string;
        vaultCollateralToken: string;
        poolTokenSuffix: string;
        feeBIPS: number | BN | string;
        poolFeeShareBIPS: number | BN | string;
        mintingVaultCollateralRatioBIPS: number | BN | string;
        mintingPoolCollateralRatioBIPS: number | BN | string;
        buyFAssetByAgentFactorBIPS: number | BN | string;
        poolExitCollateralRatioBIPS: number | BN | string;
        poolTopupCollateralRatioBIPS: number | BN | string;
        poolTopupTokenPriceFactorBIPS: number | BN | string;
      },
      txDetails?: Truffle.TransactionDetails
    ): Promise<string>;
    sendTransaction(
      _assetManager: string,
      _agentVault: string,
      _settings: {
        underlyingAddressString: string;
        vaultCollateralToken: string;
        poolTokenSuffix: string;
        feeBIPS: number | BN | string;
        poolFeeShareBIPS: number | BN | string;
        mintingVaultCollateralRatioBIPS: number | BN | string;
        mintingPoolCollateralRatioBIPS: number | BN | string;
        buyFAssetByAgentFactorBIPS: number | BN | string;
        poolExitCollateralRatioBIPS: number | BN | string;
        poolTopupCollateralRatioBIPS: number | BN | string;
        poolTopupTokenPriceFactorBIPS: number | BN | string;
      },
      txDetails?: Truffle.TransactionDetails
    ): Promise<string>;
    estimateGas(
      _assetManager: string,
      _agentVault: string,
      _settings: {
        underlyingAddressString: string;
        vaultCollateralToken: string;
        poolTokenSuffix: string;
        feeBIPS: number | BN | string;
        poolFeeShareBIPS: number | BN | string;
        mintingVaultCollateralRatioBIPS: number | BN | string;
        mintingPoolCollateralRatioBIPS: number | BN | string;
        buyFAssetByAgentFactorBIPS: number | BN | string;
        poolExitCollateralRatioBIPS: number | BN | string;
        poolTopupCollateralRatioBIPS: number | BN | string;
        poolTopupTokenPriceFactorBIPS: number | BN | string;
      },
      txDetails?: Truffle.TransactionDetails
    ): Promise<number>;
  };

  supportsInterface(
    _interfaceId: string,
    txDetails?: Truffle.TransactionDetails
  ): Promise<boolean>;

  methods: {
    create: {
      (
        _assetManager: string,
        _agentVault: string,
        _settings: {
          underlyingAddressString: string;
          vaultCollateralToken: string;
          poolTokenSuffix: string;
          feeBIPS: number | BN | string;
          poolFeeShareBIPS: number | BN | string;
          mintingVaultCollateralRatioBIPS: number | BN | string;
          mintingPoolCollateralRatioBIPS: number | BN | string;
          buyFAssetByAgentFactorBIPS: number | BN | string;
          poolExitCollateralRatioBIPS: number | BN | string;
          poolTopupCollateralRatioBIPS: number | BN | string;
          poolTopupTokenPriceFactorBIPS: number | BN | string;
        },
        txDetails?: Truffle.TransactionDetails
      ): Promise<Truffle.TransactionResponse<AllEvents>>;
      call(
        _assetManager: string,
        _agentVault: string,
        _settings: {
          underlyingAddressString: string;
          vaultCollateralToken: string;
          poolTokenSuffix: string;
          feeBIPS: number | BN | string;
          poolFeeShareBIPS: number | BN | string;
          mintingVaultCollateralRatioBIPS: number | BN | string;
          mintingPoolCollateralRatioBIPS: number | BN | string;
          buyFAssetByAgentFactorBIPS: number | BN | string;
          poolExitCollateralRatioBIPS: number | BN | string;
          poolTopupCollateralRatioBIPS: number | BN | string;
          poolTopupTokenPriceFactorBIPS: number | BN | string;
        },
        txDetails?: Truffle.TransactionDetails
      ): Promise<string>;
      sendTransaction(
        _assetManager: string,
        _agentVault: string,
        _settings: {
          underlyingAddressString: string;
          vaultCollateralToken: string;
          poolTokenSuffix: string;
          feeBIPS: number | BN | string;
          poolFeeShareBIPS: number | BN | string;
          mintingVaultCollateralRatioBIPS: number | BN | string;
          mintingPoolCollateralRatioBIPS: number | BN | string;
          buyFAssetByAgentFactorBIPS: number | BN | string;
          poolExitCollateralRatioBIPS: number | BN | string;
          poolTopupCollateralRatioBIPS: number | BN | string;
          poolTopupTokenPriceFactorBIPS: number | BN | string;
        },
        txDetails?: Truffle.TransactionDetails
      ): Promise<string>;
      estimateGas(
        _assetManager: string,
        _agentVault: string,
        _settings: {
          underlyingAddressString: string;
          vaultCollateralToken: string;
          poolTokenSuffix: string;
          feeBIPS: number | BN | string;
          poolFeeShareBIPS: number | BN | string;
          mintingVaultCollateralRatioBIPS: number | BN | string;
          mintingPoolCollateralRatioBIPS: number | BN | string;
          buyFAssetByAgentFactorBIPS: number | BN | string;
          poolExitCollateralRatioBIPS: number | BN | string;
          poolTopupCollateralRatioBIPS: number | BN | string;
          poolTopupTokenPriceFactorBIPS: number | BN | string;
        },
        txDetails?: Truffle.TransactionDetails
      ): Promise<number>;
    };

    supportsInterface(
      _interfaceId: string,
      txDetails?: Truffle.TransactionDetails
    ): Promise<boolean>;
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
