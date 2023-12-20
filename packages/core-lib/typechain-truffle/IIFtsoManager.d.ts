/* Autogenerated file. Do not edit manually. */
/* tslint:disable */
/* eslint-disable */

import BN from "bn.js";
import { EventData, PastEventOptions } from "web3-eth-contract";

export interface IIFtsoManagerContract
  extends Truffle.Contract<IIFtsoManagerInstance> {
  "new"(meta?: Truffle.TransactionDetails): Promise<IIFtsoManagerInstance>;
}

export interface AccruingUnearnedRewardsFailed {
  name: "AccruingUnearnedRewardsFailed";
  args: {
    epochId: BN;
    0: BN;
  };
}

export interface CleanupBlockNumberManagerFailedForBlock {
  name: "CleanupBlockNumberManagerFailedForBlock";
  args: {
    blockNumber: BN;
    0: BN;
  };
}

export interface ClosingExpiredRewardEpochFailed {
  name: "ClosingExpiredRewardEpochFailed";
  args: {
    rewardEpoch: BN;
    0: BN;
  };
}

export interface DistributingRewardsFailed {
  name: "DistributingRewardsFailed";
  args: {
    ftso: string;
    epochId: BN;
    0: string;
    1: BN;
  };
}

export interface FallbackMode {
  name: "FallbackMode";
  args: {
    fallbackMode: boolean;
    0: boolean;
  };
}

export interface FinalizingPriceEpochFailed {
  name: "FinalizingPriceEpochFailed";
  args: {
    ftso: string;
    epochId: BN;
    failingType: BN;
    0: string;
    1: BN;
    2: BN;
  };
}

export interface FtsoAdded {
  name: "FtsoAdded";
  args: {
    ftso: string;
    add: boolean;
    0: string;
    1: boolean;
  };
}

export interface FtsoDeactivationFailed {
  name: "FtsoDeactivationFailed";
  args: {
    ftso: string;
    0: string;
  };
}

export interface FtsoFallbackMode {
  name: "FtsoFallbackMode";
  args: {
    ftso: string;
    fallbackMode: boolean;
    0: string;
    1: boolean;
  };
}

export interface InitializingCurrentEpochStateForRevealFailed {
  name: "InitializingCurrentEpochStateForRevealFailed";
  args: {
    ftso: string;
    epochId: BN;
    0: string;
    1: BN;
  };
}

export interface PriceEpochFinalized {
  name: "PriceEpochFinalized";
  args: {
    chosenFtso: string;
    rewardEpochId: BN;
    0: string;
    1: BN;
  };
}

export interface RewardEpochFinalized {
  name: "RewardEpochFinalized";
  args: {
    votepowerBlock: BN;
    startBlock: BN;
    0: BN;
    1: BN;
  };
}

export interface UpdatingActiveValidatorsTriggerFailed {
  name: "UpdatingActiveValidatorsTriggerFailed";
  args: {
    rewardEpoch: BN;
    0: BN;
  };
}

type AllEvents =
  | AccruingUnearnedRewardsFailed
  | CleanupBlockNumberManagerFailedForBlock
  | ClosingExpiredRewardEpochFailed
  | DistributingRewardsFailed
  | FallbackMode
  | FinalizingPriceEpochFailed
  | FtsoAdded
  | FtsoDeactivationFailed
  | FtsoFallbackMode
  | InitializingCurrentEpochStateForRevealFailed
  | PriceEpochFinalized
  | RewardEpochFinalized
  | UpdatingActiveValidatorsTriggerFailed;

export interface IIFtsoManagerInstance extends Truffle.ContractInstance {
  activate: {
    (txDetails?: Truffle.TransactionDetails): Promise<
      Truffle.TransactionResponse<AllEvents>
    >;
    call(txDetails?: Truffle.TransactionDetails): Promise<void>;
    sendTransaction(txDetails?: Truffle.TransactionDetails): Promise<string>;
    estimateGas(txDetails?: Truffle.TransactionDetails): Promise<number>;
  };

  active(txDetails?: Truffle.TransactionDetails): Promise<boolean>;

  addFtso: {
    (_ftso: string, txDetails?: Truffle.TransactionDetails): Promise<
      Truffle.TransactionResponse<AllEvents>
    >;
    call(_ftso: string, txDetails?: Truffle.TransactionDetails): Promise<void>;
    sendTransaction(
      _ftso: string,
      txDetails?: Truffle.TransactionDetails
    ): Promise<string>;
    estimateGas(
      _ftso: string,
      txDetails?: Truffle.TransactionDetails
    ): Promise<number>;
  };

  addFtsosBulk: {
    (_ftsos: string[], txDetails?: Truffle.TransactionDetails): Promise<
      Truffle.TransactionResponse<AllEvents>
    >;
    call(
      _ftsos: string[],
      txDetails?: Truffle.TransactionDetails
    ): Promise<void>;
    sendTransaction(
      _ftsos: string[],
      txDetails?: Truffle.TransactionDetails
    ): Promise<string>;
    estimateGas(
      _ftsos: string[],
      txDetails?: Truffle.TransactionDetails
    ): Promise<number>;
  };

  currentRewardEpochEnds(txDetails?: Truffle.TransactionDetails): Promise<BN>;

  daemonize: {
    (txDetails?: Truffle.TransactionDetails): Promise<
      Truffle.TransactionResponse<AllEvents>
    >;
    call(txDetails?: Truffle.TransactionDetails): Promise<boolean>;
    sendTransaction(txDetails?: Truffle.TransactionDetails): Promise<string>;
    estimateGas(txDetails?: Truffle.TransactionDetails): Promise<number>;
  };

  getContractName(txDetails?: Truffle.TransactionDetails): Promise<string>;

  getCurrentPriceEpochData(
    txDetails?: Truffle.TransactionDetails
  ): Promise<{ 0: BN; 1: BN; 2: BN; 3: BN; 4: BN }>;

  getCurrentPriceEpochId(txDetails?: Truffle.TransactionDetails): Promise<BN>;

  getCurrentRewardEpoch(txDetails?: Truffle.TransactionDetails): Promise<BN>;

  getFallbackMode(
    txDetails?: Truffle.TransactionDetails
  ): Promise<{ 0: boolean; 1: string[]; 2: boolean[] }>;

  getFtsos(txDetails?: Truffle.TransactionDetails): Promise<string[]>;

  getLastUnprocessedPriceEpochData(
    txDetails?: Truffle.TransactionDetails
  ): Promise<{ 0: BN; 1: BN; 2: boolean }>;

  getPriceEpochConfiguration(
    txDetails?: Truffle.TransactionDetails
  ): Promise<{ 0: BN; 1: BN; 2: BN }>;

  getRewardEpochConfiguration(
    txDetails?: Truffle.TransactionDetails
  ): Promise<{ 0: BN; 1: BN }>;

  getRewardEpochData(
    _rewardEpochId: number | BN | string,
    txDetails?: Truffle.TransactionDetails
  ): Promise<{ votepowerBlock: BN; startBlock: BN; startTimestamp: BN }>;

  getRewardEpochToExpireNext(
    txDetails?: Truffle.TransactionDetails
  ): Promise<BN>;

  getRewardEpochVotePowerBlock(
    _rewardEpoch: number | BN | string,
    txDetails?: Truffle.TransactionDetails
  ): Promise<BN>;

  getRewardExpiryOffsetSeconds(
    txDetails?: Truffle.TransactionDetails
  ): Promise<BN>;

  notInitializedFtsos(
    arg0: string,
    txDetails?: Truffle.TransactionDetails
  ): Promise<boolean>;

  removeFtso: {
    (_ftso: string, txDetails?: Truffle.TransactionDetails): Promise<
      Truffle.TransactionResponse<AllEvents>
    >;
    call(_ftso: string, txDetails?: Truffle.TransactionDetails): Promise<void>;
    sendTransaction(
      _ftso: string,
      txDetails?: Truffle.TransactionDetails
    ): Promise<string>;
    estimateGas(
      _ftso: string,
      txDetails?: Truffle.TransactionDetails
    ): Promise<number>;
  };

  replaceFtso: {
    (
      _ftsoToAdd: string,
      copyCurrentPrice: boolean,
      copyAssetOrAssetFtsos: boolean,
      txDetails?: Truffle.TransactionDetails
    ): Promise<Truffle.TransactionResponse<AllEvents>>;
    call(
      _ftsoToAdd: string,
      copyCurrentPrice: boolean,
      copyAssetOrAssetFtsos: boolean,
      txDetails?: Truffle.TransactionDetails
    ): Promise<void>;
    sendTransaction(
      _ftsoToAdd: string,
      copyCurrentPrice: boolean,
      copyAssetOrAssetFtsos: boolean,
      txDetails?: Truffle.TransactionDetails
    ): Promise<string>;
    estimateGas(
      _ftsoToAdd: string,
      copyCurrentPrice: boolean,
      copyAssetOrAssetFtsos: boolean,
      txDetails?: Truffle.TransactionDetails
    ): Promise<number>;
  };

  replaceFtsosBulk: {
    (
      _ftsosToAdd: string[],
      copyCurrentPrice: boolean,
      copyAssetOrAssetFtsos: boolean,
      txDetails?: Truffle.TransactionDetails
    ): Promise<Truffle.TransactionResponse<AllEvents>>;
    call(
      _ftsosToAdd: string[],
      copyCurrentPrice: boolean,
      copyAssetOrAssetFtsos: boolean,
      txDetails?: Truffle.TransactionDetails
    ): Promise<void>;
    sendTransaction(
      _ftsosToAdd: string[],
      copyCurrentPrice: boolean,
      copyAssetOrAssetFtsos: boolean,
      txDetails?: Truffle.TransactionDetails
    ): Promise<string>;
    estimateGas(
      _ftsosToAdd: string[],
      copyCurrentPrice: boolean,
      copyAssetOrAssetFtsos: boolean,
      txDetails?: Truffle.TransactionDetails
    ): Promise<number>;
  };

  rewardEpochDurationSeconds(
    txDetails?: Truffle.TransactionDetails
  ): Promise<BN>;

  rewardEpochs(
    _rewardEpochId: number | BN | string,
    txDetails?: Truffle.TransactionDetails
  ): Promise<{ 0: BN; 1: BN; 2: BN }>;

  rewardEpochsStartTs(txDetails?: Truffle.TransactionDetails): Promise<BN>;

  setFallbackMode: {
    (_fallbackMode: boolean, txDetails?: Truffle.TransactionDetails): Promise<
      Truffle.TransactionResponse<AllEvents>
    >;
    call(
      _fallbackMode: boolean,
      txDetails?: Truffle.TransactionDetails
    ): Promise<void>;
    sendTransaction(
      _fallbackMode: boolean,
      txDetails?: Truffle.TransactionDetails
    ): Promise<string>;
    estimateGas(
      _fallbackMode: boolean,
      txDetails?: Truffle.TransactionDetails
    ): Promise<number>;
  };

  setFtsoAsset: {
    (
      _ftso: string,
      _asset: string,
      txDetails?: Truffle.TransactionDetails
    ): Promise<Truffle.TransactionResponse<AllEvents>>;
    call(
      _ftso: string,
      _asset: string,
      txDetails?: Truffle.TransactionDetails
    ): Promise<void>;
    sendTransaction(
      _ftso: string,
      _asset: string,
      txDetails?: Truffle.TransactionDetails
    ): Promise<string>;
    estimateGas(
      _ftso: string,
      _asset: string,
      txDetails?: Truffle.TransactionDetails
    ): Promise<number>;
  };

  setFtsoAssetFtsos: {
    (
      _ftso: string,
      _assetFtsos: string[],
      txDetails?: Truffle.TransactionDetails
    ): Promise<Truffle.TransactionResponse<AllEvents>>;
    call(
      _ftso: string,
      _assetFtsos: string[],
      txDetails?: Truffle.TransactionDetails
    ): Promise<void>;
    sendTransaction(
      _ftso: string,
      _assetFtsos: string[],
      txDetails?: Truffle.TransactionDetails
    ): Promise<string>;
    estimateGas(
      _ftso: string,
      _assetFtsos: string[],
      txDetails?: Truffle.TransactionDetails
    ): Promise<number>;
  };

  setFtsoFallbackMode: {
    (
      _ftso: string,
      _fallbackMode: boolean,
      txDetails?: Truffle.TransactionDetails
    ): Promise<Truffle.TransactionResponse<AllEvents>>;
    call(
      _ftso: string,
      _fallbackMode: boolean,
      txDetails?: Truffle.TransactionDetails
    ): Promise<void>;
    sendTransaction(
      _ftso: string,
      _fallbackMode: boolean,
      txDetails?: Truffle.TransactionDetails
    ): Promise<string>;
    estimateGas(
      _ftso: string,
      _fallbackMode: boolean,
      txDetails?: Truffle.TransactionDetails
    ): Promise<number>;
  };

  setGovernanceParameters: {
    (
      _maxVotePowerNatThresholdFraction: number | BN | string,
      _maxVotePowerAssetThresholdFraction: number | BN | string,
      _lowAssetUSDThreshold: number | BN | string,
      _highAssetUSDThreshold: number | BN | string,
      _highAssetTurnoutThresholdBIPS: number | BN | string,
      _lowNatTurnoutThresholdBIPS: number | BN | string,
      _rewardExpiryOffsetSeconds: number | BN | string,
      _trustedAddresses: string[],
      txDetails?: Truffle.TransactionDetails
    ): Promise<Truffle.TransactionResponse<AllEvents>>;
    call(
      _maxVotePowerNatThresholdFraction: number | BN | string,
      _maxVotePowerAssetThresholdFraction: number | BN | string,
      _lowAssetUSDThreshold: number | BN | string,
      _highAssetUSDThreshold: number | BN | string,
      _highAssetTurnoutThresholdBIPS: number | BN | string,
      _lowNatTurnoutThresholdBIPS: number | BN | string,
      _rewardExpiryOffsetSeconds: number | BN | string,
      _trustedAddresses: string[],
      txDetails?: Truffle.TransactionDetails
    ): Promise<void>;
    sendTransaction(
      _maxVotePowerNatThresholdFraction: number | BN | string,
      _maxVotePowerAssetThresholdFraction: number | BN | string,
      _lowAssetUSDThreshold: number | BN | string,
      _highAssetUSDThreshold: number | BN | string,
      _highAssetTurnoutThresholdBIPS: number | BN | string,
      _lowNatTurnoutThresholdBIPS: number | BN | string,
      _rewardExpiryOffsetSeconds: number | BN | string,
      _trustedAddresses: string[],
      txDetails?: Truffle.TransactionDetails
    ): Promise<string>;
    estimateGas(
      _maxVotePowerNatThresholdFraction: number | BN | string,
      _maxVotePowerAssetThresholdFraction: number | BN | string,
      _lowAssetUSDThreshold: number | BN | string,
      _highAssetUSDThreshold: number | BN | string,
      _highAssetTurnoutThresholdBIPS: number | BN | string,
      _lowNatTurnoutThresholdBIPS: number | BN | string,
      _rewardExpiryOffsetSeconds: number | BN | string,
      _trustedAddresses: string[],
      txDetails?: Truffle.TransactionDetails
    ): Promise<number>;
  };

  setInitialRewardData: {
    (
      _nextRewardEpochToExpire: number | BN | string,
      _rewardEpochsLength: number | BN | string,
      _currentRewardEpochEnds: number | BN | string,
      txDetails?: Truffle.TransactionDetails
    ): Promise<Truffle.TransactionResponse<AllEvents>>;
    call(
      _nextRewardEpochToExpire: number | BN | string,
      _rewardEpochsLength: number | BN | string,
      _currentRewardEpochEnds: number | BN | string,
      txDetails?: Truffle.TransactionDetails
    ): Promise<void>;
    sendTransaction(
      _nextRewardEpochToExpire: number | BN | string,
      _rewardEpochsLength: number | BN | string,
      _currentRewardEpochEnds: number | BN | string,
      txDetails?: Truffle.TransactionDetails
    ): Promise<string>;
    estimateGas(
      _nextRewardEpochToExpire: number | BN | string,
      _rewardEpochsLength: number | BN | string,
      _currentRewardEpochEnds: number | BN | string,
      txDetails?: Truffle.TransactionDetails
    ): Promise<number>;
  };

  switchToFallbackMode: {
    (txDetails?: Truffle.TransactionDetails): Promise<
      Truffle.TransactionResponse<AllEvents>
    >;
    call(txDetails?: Truffle.TransactionDetails): Promise<boolean>;
    sendTransaction(txDetails?: Truffle.TransactionDetails): Promise<string>;
    estimateGas(txDetails?: Truffle.TransactionDetails): Promise<number>;
  };

  methods: {
    activate: {
      (txDetails?: Truffle.TransactionDetails): Promise<
        Truffle.TransactionResponse<AllEvents>
      >;
      call(txDetails?: Truffle.TransactionDetails): Promise<void>;
      sendTransaction(txDetails?: Truffle.TransactionDetails): Promise<string>;
      estimateGas(txDetails?: Truffle.TransactionDetails): Promise<number>;
    };

    active(txDetails?: Truffle.TransactionDetails): Promise<boolean>;

    addFtso: {
      (_ftso: string, txDetails?: Truffle.TransactionDetails): Promise<
        Truffle.TransactionResponse<AllEvents>
      >;
      call(
        _ftso: string,
        txDetails?: Truffle.TransactionDetails
      ): Promise<void>;
      sendTransaction(
        _ftso: string,
        txDetails?: Truffle.TransactionDetails
      ): Promise<string>;
      estimateGas(
        _ftso: string,
        txDetails?: Truffle.TransactionDetails
      ): Promise<number>;
    };

    addFtsosBulk: {
      (_ftsos: string[], txDetails?: Truffle.TransactionDetails): Promise<
        Truffle.TransactionResponse<AllEvents>
      >;
      call(
        _ftsos: string[],
        txDetails?: Truffle.TransactionDetails
      ): Promise<void>;
      sendTransaction(
        _ftsos: string[],
        txDetails?: Truffle.TransactionDetails
      ): Promise<string>;
      estimateGas(
        _ftsos: string[],
        txDetails?: Truffle.TransactionDetails
      ): Promise<number>;
    };

    currentRewardEpochEnds(txDetails?: Truffle.TransactionDetails): Promise<BN>;

    daemonize: {
      (txDetails?: Truffle.TransactionDetails): Promise<
        Truffle.TransactionResponse<AllEvents>
      >;
      call(txDetails?: Truffle.TransactionDetails): Promise<boolean>;
      sendTransaction(txDetails?: Truffle.TransactionDetails): Promise<string>;
      estimateGas(txDetails?: Truffle.TransactionDetails): Promise<number>;
    };

    getContractName(txDetails?: Truffle.TransactionDetails): Promise<string>;

    getCurrentPriceEpochData(
      txDetails?: Truffle.TransactionDetails
    ): Promise<{ 0: BN; 1: BN; 2: BN; 3: BN; 4: BN }>;

    getCurrentPriceEpochId(txDetails?: Truffle.TransactionDetails): Promise<BN>;

    getCurrentRewardEpoch(txDetails?: Truffle.TransactionDetails): Promise<BN>;

    getFallbackMode(
      txDetails?: Truffle.TransactionDetails
    ): Promise<{ 0: boolean; 1: string[]; 2: boolean[] }>;

    getFtsos(txDetails?: Truffle.TransactionDetails): Promise<string[]>;

    getLastUnprocessedPriceEpochData(
      txDetails?: Truffle.TransactionDetails
    ): Promise<{ 0: BN; 1: BN; 2: boolean }>;

    getPriceEpochConfiguration(
      txDetails?: Truffle.TransactionDetails
    ): Promise<{ 0: BN; 1: BN; 2: BN }>;

    getRewardEpochConfiguration(
      txDetails?: Truffle.TransactionDetails
    ): Promise<{ 0: BN; 1: BN }>;

    getRewardEpochData(
      _rewardEpochId: number | BN | string,
      txDetails?: Truffle.TransactionDetails
    ): Promise<{ votepowerBlock: BN; startBlock: BN; startTimestamp: BN }>;

    getRewardEpochToExpireNext(
      txDetails?: Truffle.TransactionDetails
    ): Promise<BN>;

    getRewardEpochVotePowerBlock(
      _rewardEpoch: number | BN | string,
      txDetails?: Truffle.TransactionDetails
    ): Promise<BN>;

    getRewardExpiryOffsetSeconds(
      txDetails?: Truffle.TransactionDetails
    ): Promise<BN>;

    notInitializedFtsos(
      arg0: string,
      txDetails?: Truffle.TransactionDetails
    ): Promise<boolean>;

    removeFtso: {
      (_ftso: string, txDetails?: Truffle.TransactionDetails): Promise<
        Truffle.TransactionResponse<AllEvents>
      >;
      call(
        _ftso: string,
        txDetails?: Truffle.TransactionDetails
      ): Promise<void>;
      sendTransaction(
        _ftso: string,
        txDetails?: Truffle.TransactionDetails
      ): Promise<string>;
      estimateGas(
        _ftso: string,
        txDetails?: Truffle.TransactionDetails
      ): Promise<number>;
    };

    replaceFtso: {
      (
        _ftsoToAdd: string,
        copyCurrentPrice: boolean,
        copyAssetOrAssetFtsos: boolean,
        txDetails?: Truffle.TransactionDetails
      ): Promise<Truffle.TransactionResponse<AllEvents>>;
      call(
        _ftsoToAdd: string,
        copyCurrentPrice: boolean,
        copyAssetOrAssetFtsos: boolean,
        txDetails?: Truffle.TransactionDetails
      ): Promise<void>;
      sendTransaction(
        _ftsoToAdd: string,
        copyCurrentPrice: boolean,
        copyAssetOrAssetFtsos: boolean,
        txDetails?: Truffle.TransactionDetails
      ): Promise<string>;
      estimateGas(
        _ftsoToAdd: string,
        copyCurrentPrice: boolean,
        copyAssetOrAssetFtsos: boolean,
        txDetails?: Truffle.TransactionDetails
      ): Promise<number>;
    };

    replaceFtsosBulk: {
      (
        _ftsosToAdd: string[],
        copyCurrentPrice: boolean,
        copyAssetOrAssetFtsos: boolean,
        txDetails?: Truffle.TransactionDetails
      ): Promise<Truffle.TransactionResponse<AllEvents>>;
      call(
        _ftsosToAdd: string[],
        copyCurrentPrice: boolean,
        copyAssetOrAssetFtsos: boolean,
        txDetails?: Truffle.TransactionDetails
      ): Promise<void>;
      sendTransaction(
        _ftsosToAdd: string[],
        copyCurrentPrice: boolean,
        copyAssetOrAssetFtsos: boolean,
        txDetails?: Truffle.TransactionDetails
      ): Promise<string>;
      estimateGas(
        _ftsosToAdd: string[],
        copyCurrentPrice: boolean,
        copyAssetOrAssetFtsos: boolean,
        txDetails?: Truffle.TransactionDetails
      ): Promise<number>;
    };

    rewardEpochDurationSeconds(
      txDetails?: Truffle.TransactionDetails
    ): Promise<BN>;

    rewardEpochs(
      _rewardEpochId: number | BN | string,
      txDetails?: Truffle.TransactionDetails
    ): Promise<{ 0: BN; 1: BN; 2: BN }>;

    rewardEpochsStartTs(txDetails?: Truffle.TransactionDetails): Promise<BN>;

    setFallbackMode: {
      (_fallbackMode: boolean, txDetails?: Truffle.TransactionDetails): Promise<
        Truffle.TransactionResponse<AllEvents>
      >;
      call(
        _fallbackMode: boolean,
        txDetails?: Truffle.TransactionDetails
      ): Promise<void>;
      sendTransaction(
        _fallbackMode: boolean,
        txDetails?: Truffle.TransactionDetails
      ): Promise<string>;
      estimateGas(
        _fallbackMode: boolean,
        txDetails?: Truffle.TransactionDetails
      ): Promise<number>;
    };

    setFtsoAsset: {
      (
        _ftso: string,
        _asset: string,
        txDetails?: Truffle.TransactionDetails
      ): Promise<Truffle.TransactionResponse<AllEvents>>;
      call(
        _ftso: string,
        _asset: string,
        txDetails?: Truffle.TransactionDetails
      ): Promise<void>;
      sendTransaction(
        _ftso: string,
        _asset: string,
        txDetails?: Truffle.TransactionDetails
      ): Promise<string>;
      estimateGas(
        _ftso: string,
        _asset: string,
        txDetails?: Truffle.TransactionDetails
      ): Promise<number>;
    };

    setFtsoAssetFtsos: {
      (
        _ftso: string,
        _assetFtsos: string[],
        txDetails?: Truffle.TransactionDetails
      ): Promise<Truffle.TransactionResponse<AllEvents>>;
      call(
        _ftso: string,
        _assetFtsos: string[],
        txDetails?: Truffle.TransactionDetails
      ): Promise<void>;
      sendTransaction(
        _ftso: string,
        _assetFtsos: string[],
        txDetails?: Truffle.TransactionDetails
      ): Promise<string>;
      estimateGas(
        _ftso: string,
        _assetFtsos: string[],
        txDetails?: Truffle.TransactionDetails
      ): Promise<number>;
    };

    setFtsoFallbackMode: {
      (
        _ftso: string,
        _fallbackMode: boolean,
        txDetails?: Truffle.TransactionDetails
      ): Promise<Truffle.TransactionResponse<AllEvents>>;
      call(
        _ftso: string,
        _fallbackMode: boolean,
        txDetails?: Truffle.TransactionDetails
      ): Promise<void>;
      sendTransaction(
        _ftso: string,
        _fallbackMode: boolean,
        txDetails?: Truffle.TransactionDetails
      ): Promise<string>;
      estimateGas(
        _ftso: string,
        _fallbackMode: boolean,
        txDetails?: Truffle.TransactionDetails
      ): Promise<number>;
    };

    setGovernanceParameters: {
      (
        _maxVotePowerNatThresholdFraction: number | BN | string,
        _maxVotePowerAssetThresholdFraction: number | BN | string,
        _lowAssetUSDThreshold: number | BN | string,
        _highAssetUSDThreshold: number | BN | string,
        _highAssetTurnoutThresholdBIPS: number | BN | string,
        _lowNatTurnoutThresholdBIPS: number | BN | string,
        _rewardExpiryOffsetSeconds: number | BN | string,
        _trustedAddresses: string[],
        txDetails?: Truffle.TransactionDetails
      ): Promise<Truffle.TransactionResponse<AllEvents>>;
      call(
        _maxVotePowerNatThresholdFraction: number | BN | string,
        _maxVotePowerAssetThresholdFraction: number | BN | string,
        _lowAssetUSDThreshold: number | BN | string,
        _highAssetUSDThreshold: number | BN | string,
        _highAssetTurnoutThresholdBIPS: number | BN | string,
        _lowNatTurnoutThresholdBIPS: number | BN | string,
        _rewardExpiryOffsetSeconds: number | BN | string,
        _trustedAddresses: string[],
        txDetails?: Truffle.TransactionDetails
      ): Promise<void>;
      sendTransaction(
        _maxVotePowerNatThresholdFraction: number | BN | string,
        _maxVotePowerAssetThresholdFraction: number | BN | string,
        _lowAssetUSDThreshold: number | BN | string,
        _highAssetUSDThreshold: number | BN | string,
        _highAssetTurnoutThresholdBIPS: number | BN | string,
        _lowNatTurnoutThresholdBIPS: number | BN | string,
        _rewardExpiryOffsetSeconds: number | BN | string,
        _trustedAddresses: string[],
        txDetails?: Truffle.TransactionDetails
      ): Promise<string>;
      estimateGas(
        _maxVotePowerNatThresholdFraction: number | BN | string,
        _maxVotePowerAssetThresholdFraction: number | BN | string,
        _lowAssetUSDThreshold: number | BN | string,
        _highAssetUSDThreshold: number | BN | string,
        _highAssetTurnoutThresholdBIPS: number | BN | string,
        _lowNatTurnoutThresholdBIPS: number | BN | string,
        _rewardExpiryOffsetSeconds: number | BN | string,
        _trustedAddresses: string[],
        txDetails?: Truffle.TransactionDetails
      ): Promise<number>;
    };

    setInitialRewardData: {
      (
        _nextRewardEpochToExpire: number | BN | string,
        _rewardEpochsLength: number | BN | string,
        _currentRewardEpochEnds: number | BN | string,
        txDetails?: Truffle.TransactionDetails
      ): Promise<Truffle.TransactionResponse<AllEvents>>;
      call(
        _nextRewardEpochToExpire: number | BN | string,
        _rewardEpochsLength: number | BN | string,
        _currentRewardEpochEnds: number | BN | string,
        txDetails?: Truffle.TransactionDetails
      ): Promise<void>;
      sendTransaction(
        _nextRewardEpochToExpire: number | BN | string,
        _rewardEpochsLength: number | BN | string,
        _currentRewardEpochEnds: number | BN | string,
        txDetails?: Truffle.TransactionDetails
      ): Promise<string>;
      estimateGas(
        _nextRewardEpochToExpire: number | BN | string,
        _rewardEpochsLength: number | BN | string,
        _currentRewardEpochEnds: number | BN | string,
        txDetails?: Truffle.TransactionDetails
      ): Promise<number>;
    };

    switchToFallbackMode: {
      (txDetails?: Truffle.TransactionDetails): Promise<
        Truffle.TransactionResponse<AllEvents>
      >;
      call(txDetails?: Truffle.TransactionDetails): Promise<boolean>;
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