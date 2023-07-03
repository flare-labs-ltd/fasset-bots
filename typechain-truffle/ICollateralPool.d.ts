/* Autogenerated file. Do not edit manually. */
/* tslint:disable */
/* eslint-disable */

import BN from "bn.js";
import { EventData, PastEventOptions } from "web3-eth-contract";

export interface ICollateralPoolContract
  extends Truffle.Contract<ICollateralPoolInstance> {
  "new"(meta?: Truffle.TransactionDetails): Promise<ICollateralPoolInstance>;
}

export interface Enter {
  name: "Enter";
  args: {
    tokenHolder: string;
    amountNatWei: BN;
    receivedTokensWei: BN;
    addedFAssetFeesUBA: BN;
    0: string;
    1: BN;
    2: BN;
    3: BN;
  };
}

export interface Exit {
  name: "Exit";
  args: {
    tokenHolder: string;
    burnedTokensWei: BN;
    receivedNatWei: BN;
    receviedFAssetFeesUBA: BN;
    closedFAssetsUBA: BN;
    0: string;
    1: BN;
    2: BN;
    3: BN;
    4: BN;
  };
}

export interface IncompleteSelfCloseExit {
  name: "IncompleteSelfCloseExit";
  args: {
    burnedTokensWei: BN;
    redeemedFAssetUBA: BN;
    0: BN;
    1: BN;
  };
}

type AllEvents = Enter | Exit | IncompleteSelfCloseExit;

export interface ICollateralPoolInstance extends Truffle.ContractInstance {
  agentVault(txDetails?: Truffle.TransactionDetails): Promise<string>;

  claimAirdropDistribution: {
    (
      _distribution: string,
      _month: number | BN | string,
      txDetails?: Truffle.TransactionDetails
    ): Promise<Truffle.TransactionResponse<AllEvents>>;
    call(
      _distribution: string,
      _month: number | BN | string,
      txDetails?: Truffle.TransactionDetails
    ): Promise<BN>;
    sendTransaction(
      _distribution: string,
      _month: number | BN | string,
      txDetails?: Truffle.TransactionDetails
    ): Promise<string>;
    estimateGas(
      _distribution: string,
      _month: number | BN | string,
      txDetails?: Truffle.TransactionDetails
    ): Promise<number>;
  };

  claimFtsoRewards: {
    (
      _ftsoRewardManager: string,
      _lastRewardEpoch: number | BN | string,
      txDetails?: Truffle.TransactionDetails
    ): Promise<Truffle.TransactionResponse<AllEvents>>;
    call(
      _ftsoRewardManager: string,
      _lastRewardEpoch: number | BN | string,
      txDetails?: Truffle.TransactionDetails
    ): Promise<BN>;
    sendTransaction(
      _ftsoRewardManager: string,
      _lastRewardEpoch: number | BN | string,
      txDetails?: Truffle.TransactionDetails
    ): Promise<string>;
    estimateGas(
      _ftsoRewardManager: string,
      _lastRewardEpoch: number | BN | string,
      txDetails?: Truffle.TransactionDetails
    ): Promise<number>;
  };

  delegate: {
    (
      _to: string[],
      _bips: (number | BN | string)[],
      txDetails?: Truffle.TransactionDetails
    ): Promise<Truffle.TransactionResponse<AllEvents>>;
    call(
      _to: string[],
      _bips: (number | BN | string)[],
      txDetails?: Truffle.TransactionDetails
    ): Promise<void>;
    sendTransaction(
      _to: string[],
      _bips: (number | BN | string)[],
      txDetails?: Truffle.TransactionDetails
    ): Promise<string>;
    estimateGas(
      _to: string[],
      _bips: (number | BN | string)[],
      txDetails?: Truffle.TransactionDetails
    ): Promise<number>;
  };

  enter: {
    (
      _fAssets: number | BN | string,
      _enterWithFullFassets: boolean,
      txDetails?: Truffle.TransactionDetails
    ): Promise<Truffle.TransactionResponse<AllEvents>>;
    call(
      _fAssets: number | BN | string,
      _enterWithFullFassets: boolean,
      txDetails?: Truffle.TransactionDetails
    ): Promise<void>;
    sendTransaction(
      _fAssets: number | BN | string,
      _enterWithFullFassets: boolean,
      txDetails?: Truffle.TransactionDetails
    ): Promise<string>;
    estimateGas(
      _fAssets: number | BN | string,
      _enterWithFullFassets: boolean,
      txDetails?: Truffle.TransactionDetails
    ): Promise<number>;
  };

  exit: {
    (
      _tokenShare: number | BN | string,
      _exitType: number | BN | string,
      txDetails?: Truffle.TransactionDetails
    ): Promise<Truffle.TransactionResponse<AllEvents>>;
    call(
      _tokenShare: number | BN | string,
      _exitType: number | BN | string,
      txDetails?: Truffle.TransactionDetails
    ): Promise<{ 0: BN; 1: BN }>;
    sendTransaction(
      _tokenShare: number | BN | string,
      _exitType: number | BN | string,
      txDetails?: Truffle.TransactionDetails
    ): Promise<string>;
    estimateGas(
      _tokenShare: number | BN | string,
      _exitType: number | BN | string,
      txDetails?: Truffle.TransactionDetails
    ): Promise<number>;
  };

  exitCollateralRatioBIPS(txDetails?: Truffle.TransactionDetails): Promise<BN>;

  fAssetFeeDebtOf(
    _account: string,
    txDetails?: Truffle.TransactionDetails
  ): Promise<BN>;

  fAssetFeesOf(
    _account: string,
    txDetails?: Truffle.TransactionDetails
  ): Promise<BN>;

  fAssetRequiredForSelfCloseExit(
    _tokenAmountWei: number | BN | string,
    txDetails?: Truffle.TransactionDetails
  ): Promise<BN>;

  optOutOfAirdrop: {
    (_distribution: string, txDetails?: Truffle.TransactionDetails): Promise<
      Truffle.TransactionResponse<AllEvents>
    >;
    call(
      _distribution: string,
      txDetails?: Truffle.TransactionDetails
    ): Promise<void>;
    sendTransaction(
      _distribution: string,
      txDetails?: Truffle.TransactionDetails
    ): Promise<string>;
    estimateGas(
      _distribution: string,
      txDetails?: Truffle.TransactionDetails
    ): Promise<number>;
  };

  payFAssetFeeDebt: {
    (
      _fassets: number | BN | string,
      txDetails?: Truffle.TransactionDetails
    ): Promise<Truffle.TransactionResponse<AllEvents>>;
    call(
      _fassets: number | BN | string,
      txDetails?: Truffle.TransactionDetails
    ): Promise<void>;
    sendTransaction(
      _fassets: number | BN | string,
      txDetails?: Truffle.TransactionDetails
    ): Promise<string>;
    estimateGas(
      _fassets: number | BN | string,
      txDetails?: Truffle.TransactionDetails
    ): Promise<number>;
  };

  poolToken(txDetails?: Truffle.TransactionDetails): Promise<string>;

  selfCloseExit: {
    (
      _tokenShare: number | BN | string,
      _redeemToCollateral: boolean,
      _redeemerUnderlyingAddress: string,
      txDetails?: Truffle.TransactionDetails
    ): Promise<Truffle.TransactionResponse<AllEvents>>;
    call(
      _tokenShare: number | BN | string,
      _redeemToCollateral: boolean,
      _redeemerUnderlyingAddress: string,
      txDetails?: Truffle.TransactionDetails
    ): Promise<void>;
    sendTransaction(
      _tokenShare: number | BN | string,
      _redeemToCollateral: boolean,
      _redeemerUnderlyingAddress: string,
      txDetails?: Truffle.TransactionDetails
    ): Promise<string>;
    estimateGas(
      _tokenShare: number | BN | string,
      _redeemToCollateral: boolean,
      _redeemerUnderlyingAddress: string,
      txDetails?: Truffle.TransactionDetails
    ): Promise<number>;
  };

  setAutoClaiming: {
    (
      _claimSetupManager: string,
      _executors: string[],
      txDetails?: Truffle.TransactionDetails
    ): Promise<Truffle.TransactionResponse<AllEvents>>;
    call(
      _claimSetupManager: string,
      _executors: string[],
      txDetails?: Truffle.TransactionDetails
    ): Promise<void>;
    sendTransaction(
      _claimSetupManager: string,
      _executors: string[],
      txDetails?: Truffle.TransactionDetails
    ): Promise<string>;
    estimateGas(
      _claimSetupManager: string,
      _executors: string[],
      txDetails?: Truffle.TransactionDetails
    ): Promise<number>;
  };

  topupCollateralRatioBIPS(txDetails?: Truffle.TransactionDetails): Promise<BN>;

  topupTokenPriceFactorBIPS(
    txDetails?: Truffle.TransactionDetails
  ): Promise<BN>;

  withdrawCollateralWhenFAssetTerminated: {
    (txDetails?: Truffle.TransactionDetails): Promise<
      Truffle.TransactionResponse<AllEvents>
    >;
    call(txDetails?: Truffle.TransactionDetails): Promise<void>;
    sendTransaction(txDetails?: Truffle.TransactionDetails): Promise<string>;
    estimateGas(txDetails?: Truffle.TransactionDetails): Promise<number>;
  };

  withdrawFees: {
    (
      _amount: number | BN | string,
      txDetails?: Truffle.TransactionDetails
    ): Promise<Truffle.TransactionResponse<AllEvents>>;
    call(
      _amount: number | BN | string,
      txDetails?: Truffle.TransactionDetails
    ): Promise<void>;
    sendTransaction(
      _amount: number | BN | string,
      txDetails?: Truffle.TransactionDetails
    ): Promise<string>;
    estimateGas(
      _amount: number | BN | string,
      txDetails?: Truffle.TransactionDetails
    ): Promise<number>;
  };

  methods: {
    agentVault(txDetails?: Truffle.TransactionDetails): Promise<string>;

    claimAirdropDistribution: {
      (
        _distribution: string,
        _month: number | BN | string,
        txDetails?: Truffle.TransactionDetails
      ): Promise<Truffle.TransactionResponse<AllEvents>>;
      call(
        _distribution: string,
        _month: number | BN | string,
        txDetails?: Truffle.TransactionDetails
      ): Promise<BN>;
      sendTransaction(
        _distribution: string,
        _month: number | BN | string,
        txDetails?: Truffle.TransactionDetails
      ): Promise<string>;
      estimateGas(
        _distribution: string,
        _month: number | BN | string,
        txDetails?: Truffle.TransactionDetails
      ): Promise<number>;
    };

    claimFtsoRewards: {
      (
        _ftsoRewardManager: string,
        _lastRewardEpoch: number | BN | string,
        txDetails?: Truffle.TransactionDetails
      ): Promise<Truffle.TransactionResponse<AllEvents>>;
      call(
        _ftsoRewardManager: string,
        _lastRewardEpoch: number | BN | string,
        txDetails?: Truffle.TransactionDetails
      ): Promise<BN>;
      sendTransaction(
        _ftsoRewardManager: string,
        _lastRewardEpoch: number | BN | string,
        txDetails?: Truffle.TransactionDetails
      ): Promise<string>;
      estimateGas(
        _ftsoRewardManager: string,
        _lastRewardEpoch: number | BN | string,
        txDetails?: Truffle.TransactionDetails
      ): Promise<number>;
    };

    delegate: {
      (
        _to: string[],
        _bips: (number | BN | string)[],
        txDetails?: Truffle.TransactionDetails
      ): Promise<Truffle.TransactionResponse<AllEvents>>;
      call(
        _to: string[],
        _bips: (number | BN | string)[],
        txDetails?: Truffle.TransactionDetails
      ): Promise<void>;
      sendTransaction(
        _to: string[],
        _bips: (number | BN | string)[],
        txDetails?: Truffle.TransactionDetails
      ): Promise<string>;
      estimateGas(
        _to: string[],
        _bips: (number | BN | string)[],
        txDetails?: Truffle.TransactionDetails
      ): Promise<number>;
    };

    enter: {
      (
        _fAssets: number | BN | string,
        _enterWithFullFassets: boolean,
        txDetails?: Truffle.TransactionDetails
      ): Promise<Truffle.TransactionResponse<AllEvents>>;
      call(
        _fAssets: number | BN | string,
        _enterWithFullFassets: boolean,
        txDetails?: Truffle.TransactionDetails
      ): Promise<void>;
      sendTransaction(
        _fAssets: number | BN | string,
        _enterWithFullFassets: boolean,
        txDetails?: Truffle.TransactionDetails
      ): Promise<string>;
      estimateGas(
        _fAssets: number | BN | string,
        _enterWithFullFassets: boolean,
        txDetails?: Truffle.TransactionDetails
      ): Promise<number>;
    };

    exit: {
      (
        _tokenShare: number | BN | string,
        _exitType: number | BN | string,
        txDetails?: Truffle.TransactionDetails
      ): Promise<Truffle.TransactionResponse<AllEvents>>;
      call(
        _tokenShare: number | BN | string,
        _exitType: number | BN | string,
        txDetails?: Truffle.TransactionDetails
      ): Promise<{ 0: BN; 1: BN }>;
      sendTransaction(
        _tokenShare: number | BN | string,
        _exitType: number | BN | string,
        txDetails?: Truffle.TransactionDetails
      ): Promise<string>;
      estimateGas(
        _tokenShare: number | BN | string,
        _exitType: number | BN | string,
        txDetails?: Truffle.TransactionDetails
      ): Promise<number>;
    };

    exitCollateralRatioBIPS(
      txDetails?: Truffle.TransactionDetails
    ): Promise<BN>;

    fAssetFeeDebtOf(
      _account: string,
      txDetails?: Truffle.TransactionDetails
    ): Promise<BN>;

    fAssetFeesOf(
      _account: string,
      txDetails?: Truffle.TransactionDetails
    ): Promise<BN>;

    fAssetRequiredForSelfCloseExit(
      _tokenAmountWei: number | BN | string,
      txDetails?: Truffle.TransactionDetails
    ): Promise<BN>;

    optOutOfAirdrop: {
      (_distribution: string, txDetails?: Truffle.TransactionDetails): Promise<
        Truffle.TransactionResponse<AllEvents>
      >;
      call(
        _distribution: string,
        txDetails?: Truffle.TransactionDetails
      ): Promise<void>;
      sendTransaction(
        _distribution: string,
        txDetails?: Truffle.TransactionDetails
      ): Promise<string>;
      estimateGas(
        _distribution: string,
        txDetails?: Truffle.TransactionDetails
      ): Promise<number>;
    };

    payFAssetFeeDebt: {
      (
        _fassets: number | BN | string,
        txDetails?: Truffle.TransactionDetails
      ): Promise<Truffle.TransactionResponse<AllEvents>>;
      call(
        _fassets: number | BN | string,
        txDetails?: Truffle.TransactionDetails
      ): Promise<void>;
      sendTransaction(
        _fassets: number | BN | string,
        txDetails?: Truffle.TransactionDetails
      ): Promise<string>;
      estimateGas(
        _fassets: number | BN | string,
        txDetails?: Truffle.TransactionDetails
      ): Promise<number>;
    };

    poolToken(txDetails?: Truffle.TransactionDetails): Promise<string>;

    selfCloseExit: {
      (
        _tokenShare: number | BN | string,
        _redeemToCollateral: boolean,
        _redeemerUnderlyingAddress: string,
        txDetails?: Truffle.TransactionDetails
      ): Promise<Truffle.TransactionResponse<AllEvents>>;
      call(
        _tokenShare: number | BN | string,
        _redeemToCollateral: boolean,
        _redeemerUnderlyingAddress: string,
        txDetails?: Truffle.TransactionDetails
      ): Promise<void>;
      sendTransaction(
        _tokenShare: number | BN | string,
        _redeemToCollateral: boolean,
        _redeemerUnderlyingAddress: string,
        txDetails?: Truffle.TransactionDetails
      ): Promise<string>;
      estimateGas(
        _tokenShare: number | BN | string,
        _redeemToCollateral: boolean,
        _redeemerUnderlyingAddress: string,
        txDetails?: Truffle.TransactionDetails
      ): Promise<number>;
    };

    setAutoClaiming: {
      (
        _claimSetupManager: string,
        _executors: string[],
        txDetails?: Truffle.TransactionDetails
      ): Promise<Truffle.TransactionResponse<AllEvents>>;
      call(
        _claimSetupManager: string,
        _executors: string[],
        txDetails?: Truffle.TransactionDetails
      ): Promise<void>;
      sendTransaction(
        _claimSetupManager: string,
        _executors: string[],
        txDetails?: Truffle.TransactionDetails
      ): Promise<string>;
      estimateGas(
        _claimSetupManager: string,
        _executors: string[],
        txDetails?: Truffle.TransactionDetails
      ): Promise<number>;
    };

    topupCollateralRatioBIPS(
      txDetails?: Truffle.TransactionDetails
    ): Promise<BN>;

    topupTokenPriceFactorBIPS(
      txDetails?: Truffle.TransactionDetails
    ): Promise<BN>;

    withdrawCollateralWhenFAssetTerminated: {
      (txDetails?: Truffle.TransactionDetails): Promise<
        Truffle.TransactionResponse<AllEvents>
      >;
      call(txDetails?: Truffle.TransactionDetails): Promise<void>;
      sendTransaction(txDetails?: Truffle.TransactionDetails): Promise<string>;
      estimateGas(txDetails?: Truffle.TransactionDetails): Promise<number>;
    };

    withdrawFees: {
      (
        _amount: number | BN | string,
        txDetails?: Truffle.TransactionDetails
      ): Promise<Truffle.TransactionResponse<AllEvents>>;
      call(
        _amount: number | BN | string,
        txDetails?: Truffle.TransactionDetails
      ): Promise<void>;
      sendTransaction(
        _amount: number | BN | string,
        txDetails?: Truffle.TransactionDetails
      ): Promise<string>;
      estimateGas(
        _amount: number | BN | string,
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
