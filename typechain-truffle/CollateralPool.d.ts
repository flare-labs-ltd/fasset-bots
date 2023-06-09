/* Autogenerated file. Do not edit manually. */
/* tslint:disable */
/* eslint-disable */

import BN from "bn.js";
import { EventData, PastEventOptions } from "web3-eth-contract";

export interface CollateralPoolContract
  extends Truffle.Contract<CollateralPoolInstance> {
  "new"(
    _agentVault: string,
    _assetManager: string,
    _fAsset: string,
    _exitCollateralRatioBIPS: number | BN | string,
    _topupCollateralRatioBIPS: number | BN | string,
    _topupTokenPriceFactorBIPS: number | BN | string,
    meta?: Truffle.TransactionDetails
  ): Promise<CollateralPoolInstance>;
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

export interface CollateralPoolInstance extends Truffle.ContractInstance {
  MIN_NAT_BALANCE_AFTER_EXIT(
    txDetails?: Truffle.TransactionDetails
  ): Promise<BN>;

  MIN_NAT_TO_ENTER(txDetails?: Truffle.TransactionDetails): Promise<BN>;

  MIN_TOKEN_SUPPLY_AFTER_EXIT(
    txDetails?: Truffle.TransactionDetails
  ): Promise<BN>;

  agentVault(txDetails?: Truffle.TransactionDetails): Promise<string>;

  assetManager(txDetails?: Truffle.TransactionDetails): Promise<string>;

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
    ): Promise<void>;
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

  enter: {
    (
      _fAssets: number | BN | string,
      _enterWithFullFAssets: boolean,
      txDetails?: Truffle.TransactionDetails
    ): Promise<Truffle.TransactionResponse<AllEvents>>;
    call(
      _fAssets: number | BN | string,
      _enterWithFullFAssets: boolean,
      txDetails?: Truffle.TransactionDetails
    ): Promise<void>;
    sendTransaction(
      _fAssets: number | BN | string,
      _enterWithFullFAssets: boolean,
      txDetails?: Truffle.TransactionDetails
    ): Promise<string>;
    estimateGas(
      _fAssets: number | BN | string,
      _enterWithFullFAssets: boolean,
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

  fAsset(txDetails?: Truffle.TransactionDetails): Promise<string>;

  fAssetFeeDebtOf(
    _account: string,
    txDetails?: Truffle.TransactionDetails
  ): Promise<BN>;

  fAssetFeeDeposited: {
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

  fAssetFeesOf(
    _account: string,
    txDetails?: Truffle.TransactionDetails
  ): Promise<BN>;

  lockedTokensOf(
    _account: string,
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
      _fAssets: number | BN | string,
      txDetails?: Truffle.TransactionDetails
    ): Promise<Truffle.TransactionResponse<AllEvents>>;
    call(
      _fAssets: number | BN | string,
      txDetails?: Truffle.TransactionDetails
    ): Promise<void>;
    sendTransaction(
      _fAssets: number | BN | string,
      txDetails?: Truffle.TransactionDetails
    ): Promise<string>;
    estimateGas(
      _fAssets: number | BN | string,
      txDetails?: Truffle.TransactionDetails
    ): Promise<number>;
  };

  payout: {
    (
      _recipient: string,
      _amount: number | BN | string,
      _agentResponsibilityWei: number | BN | string,
      txDetails?: Truffle.TransactionDetails
    ): Promise<Truffle.TransactionResponse<AllEvents>>;
    call(
      _recipient: string,
      _amount: number | BN | string,
      _agentResponsibilityWei: number | BN | string,
      txDetails?: Truffle.TransactionDetails
    ): Promise<void>;
    sendTransaction(
      _recipient: string,
      _amount: number | BN | string,
      _agentResponsibilityWei: number | BN | string,
      txDetails?: Truffle.TransactionDetails
    ): Promise<string>;
    estimateGas(
      _recipient: string,
      _amount: number | BN | string,
      _agentResponsibilityWei: number | BN | string,
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

  setExitCollateralRatioBIPS: {
    (
      _exitCollateralRatioBIPS: number | BN | string,
      txDetails?: Truffle.TransactionDetails
    ): Promise<Truffle.TransactionResponse<AllEvents>>;
    call(
      _exitCollateralRatioBIPS: number | BN | string,
      txDetails?: Truffle.TransactionDetails
    ): Promise<void>;
    sendTransaction(
      _exitCollateralRatioBIPS: number | BN | string,
      txDetails?: Truffle.TransactionDetails
    ): Promise<string>;
    estimateGas(
      _exitCollateralRatioBIPS: number | BN | string,
      txDetails?: Truffle.TransactionDetails
    ): Promise<number>;
  };

  setFtsoAutoClaiming: {
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

  setPoolToken: {
    (_poolToken: string, txDetails?: Truffle.TransactionDetails): Promise<
      Truffle.TransactionResponse<AllEvents>
    >;
    call(
      _poolToken: string,
      txDetails?: Truffle.TransactionDetails
    ): Promise<void>;
    sendTransaction(
      _poolToken: string,
      txDetails?: Truffle.TransactionDetails
    ): Promise<string>;
    estimateGas(
      _poolToken: string,
      txDetails?: Truffle.TransactionDetails
    ): Promise<number>;
  };

  setTopupCollateralRatioBIPS: {
    (
      _topupCollateralRatioBIPS: number | BN | string,
      txDetails?: Truffle.TransactionDetails
    ): Promise<Truffle.TransactionResponse<AllEvents>>;
    call(
      _topupCollateralRatioBIPS: number | BN | string,
      txDetails?: Truffle.TransactionDetails
    ): Promise<void>;
    sendTransaction(
      _topupCollateralRatioBIPS: number | BN | string,
      txDetails?: Truffle.TransactionDetails
    ): Promise<string>;
    estimateGas(
      _topupCollateralRatioBIPS: number | BN | string,
      txDetails?: Truffle.TransactionDetails
    ): Promise<number>;
  };

  setTopupTokenPriceFactorBIPS: {
    (
      _topupTokenPriceFactorBIPS: number | BN | string,
      txDetails?: Truffle.TransactionDetails
    ): Promise<Truffle.TransactionResponse<AllEvents>>;
    call(
      _topupTokenPriceFactorBIPS: number | BN | string,
      txDetails?: Truffle.TransactionDetails
    ): Promise<void>;
    sendTransaction(
      _topupTokenPriceFactorBIPS: number | BN | string,
      txDetails?: Truffle.TransactionDetails
    ): Promise<string>;
    estimateGas(
      _topupTokenPriceFactorBIPS: number | BN | string,
      txDetails?: Truffle.TransactionDetails
    ): Promise<number>;
  };

  supportsInterface(
    _interfaceId: string,
    txDetails?: Truffle.TransactionDetails
  ): Promise<boolean>;

  token(txDetails?: Truffle.TransactionDetails): Promise<string>;

  topupCollateralRatioBIPS(txDetails?: Truffle.TransactionDetails): Promise<BN>;

  topupTokenPriceFactorBIPS(
    txDetails?: Truffle.TransactionDetails
  ): Promise<BN>;

  totalCollateral(txDetails?: Truffle.TransactionDetails): Promise<BN>;

  totalFAssetFeeDebt(txDetails?: Truffle.TransactionDetails): Promise<BN>;

  totalFAssetFees(txDetails?: Truffle.TransactionDetails): Promise<BN>;

  transferableTokensOf(
    _account: string,
    txDetails?: Truffle.TransactionDetails
  ): Promise<BN>;

  upgradeWNatContract: {
    (_newWNat: string, txDetails?: Truffle.TransactionDetails): Promise<
      Truffle.TransactionResponse<AllEvents>
    >;
    call(
      _newWNat: string,
      txDetails?: Truffle.TransactionDetails
    ): Promise<void>;
    sendTransaction(
      _newWNat: string,
      txDetails?: Truffle.TransactionDetails
    ): Promise<string>;
    estimateGas(
      _newWNat: string,
      txDetails?: Truffle.TransactionDetails
    ): Promise<number>;
  };

  virtualFAssetOf(
    _account: string,
    txDetails?: Truffle.TransactionDetails
  ): Promise<BN>;

  wNat(txDetails?: Truffle.TransactionDetails): Promise<string>;

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
      _fAssets: number | BN | string,
      txDetails?: Truffle.TransactionDetails
    ): Promise<Truffle.TransactionResponse<AllEvents>>;
    call(
      _fAssets: number | BN | string,
      txDetails?: Truffle.TransactionDetails
    ): Promise<void>;
    sendTransaction(
      _fAssets: number | BN | string,
      txDetails?: Truffle.TransactionDetails
    ): Promise<string>;
    estimateGas(
      _fAssets: number | BN | string,
      txDetails?: Truffle.TransactionDetails
    ): Promise<number>;
  };

  methods: {
    MIN_NAT_BALANCE_AFTER_EXIT(
      txDetails?: Truffle.TransactionDetails
    ): Promise<BN>;

    MIN_NAT_TO_ENTER(txDetails?: Truffle.TransactionDetails): Promise<BN>;

    MIN_TOKEN_SUPPLY_AFTER_EXIT(
      txDetails?: Truffle.TransactionDetails
    ): Promise<BN>;

    agentVault(txDetails?: Truffle.TransactionDetails): Promise<string>;

    assetManager(txDetails?: Truffle.TransactionDetails): Promise<string>;

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
      ): Promise<void>;
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

    enter: {
      (
        _fAssets: number | BN | string,
        _enterWithFullFAssets: boolean,
        txDetails?: Truffle.TransactionDetails
      ): Promise<Truffle.TransactionResponse<AllEvents>>;
      call(
        _fAssets: number | BN | string,
        _enterWithFullFAssets: boolean,
        txDetails?: Truffle.TransactionDetails
      ): Promise<void>;
      sendTransaction(
        _fAssets: number | BN | string,
        _enterWithFullFAssets: boolean,
        txDetails?: Truffle.TransactionDetails
      ): Promise<string>;
      estimateGas(
        _fAssets: number | BN | string,
        _enterWithFullFAssets: boolean,
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

    fAsset(txDetails?: Truffle.TransactionDetails): Promise<string>;

    fAssetFeeDebtOf(
      _account: string,
      txDetails?: Truffle.TransactionDetails
    ): Promise<BN>;

    fAssetFeeDeposited: {
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

    fAssetFeesOf(
      _account: string,
      txDetails?: Truffle.TransactionDetails
    ): Promise<BN>;

    lockedTokensOf(
      _account: string,
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
        _fAssets: number | BN | string,
        txDetails?: Truffle.TransactionDetails
      ): Promise<Truffle.TransactionResponse<AllEvents>>;
      call(
        _fAssets: number | BN | string,
        txDetails?: Truffle.TransactionDetails
      ): Promise<void>;
      sendTransaction(
        _fAssets: number | BN | string,
        txDetails?: Truffle.TransactionDetails
      ): Promise<string>;
      estimateGas(
        _fAssets: number | BN | string,
        txDetails?: Truffle.TransactionDetails
      ): Promise<number>;
    };

    payout: {
      (
        _recipient: string,
        _amount: number | BN | string,
        _agentResponsibilityWei: number | BN | string,
        txDetails?: Truffle.TransactionDetails
      ): Promise<Truffle.TransactionResponse<AllEvents>>;
      call(
        _recipient: string,
        _amount: number | BN | string,
        _agentResponsibilityWei: number | BN | string,
        txDetails?: Truffle.TransactionDetails
      ): Promise<void>;
      sendTransaction(
        _recipient: string,
        _amount: number | BN | string,
        _agentResponsibilityWei: number | BN | string,
        txDetails?: Truffle.TransactionDetails
      ): Promise<string>;
      estimateGas(
        _recipient: string,
        _amount: number | BN | string,
        _agentResponsibilityWei: number | BN | string,
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

    setExitCollateralRatioBIPS: {
      (
        _exitCollateralRatioBIPS: number | BN | string,
        txDetails?: Truffle.TransactionDetails
      ): Promise<Truffle.TransactionResponse<AllEvents>>;
      call(
        _exitCollateralRatioBIPS: number | BN | string,
        txDetails?: Truffle.TransactionDetails
      ): Promise<void>;
      sendTransaction(
        _exitCollateralRatioBIPS: number | BN | string,
        txDetails?: Truffle.TransactionDetails
      ): Promise<string>;
      estimateGas(
        _exitCollateralRatioBIPS: number | BN | string,
        txDetails?: Truffle.TransactionDetails
      ): Promise<number>;
    };

    setFtsoAutoClaiming: {
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

    setPoolToken: {
      (_poolToken: string, txDetails?: Truffle.TransactionDetails): Promise<
        Truffle.TransactionResponse<AllEvents>
      >;
      call(
        _poolToken: string,
        txDetails?: Truffle.TransactionDetails
      ): Promise<void>;
      sendTransaction(
        _poolToken: string,
        txDetails?: Truffle.TransactionDetails
      ): Promise<string>;
      estimateGas(
        _poolToken: string,
        txDetails?: Truffle.TransactionDetails
      ): Promise<number>;
    };

    setTopupCollateralRatioBIPS: {
      (
        _topupCollateralRatioBIPS: number | BN | string,
        txDetails?: Truffle.TransactionDetails
      ): Promise<Truffle.TransactionResponse<AllEvents>>;
      call(
        _topupCollateralRatioBIPS: number | BN | string,
        txDetails?: Truffle.TransactionDetails
      ): Promise<void>;
      sendTransaction(
        _topupCollateralRatioBIPS: number | BN | string,
        txDetails?: Truffle.TransactionDetails
      ): Promise<string>;
      estimateGas(
        _topupCollateralRatioBIPS: number | BN | string,
        txDetails?: Truffle.TransactionDetails
      ): Promise<number>;
    };

    setTopupTokenPriceFactorBIPS: {
      (
        _topupTokenPriceFactorBIPS: number | BN | string,
        txDetails?: Truffle.TransactionDetails
      ): Promise<Truffle.TransactionResponse<AllEvents>>;
      call(
        _topupTokenPriceFactorBIPS: number | BN | string,
        txDetails?: Truffle.TransactionDetails
      ): Promise<void>;
      sendTransaction(
        _topupTokenPriceFactorBIPS: number | BN | string,
        txDetails?: Truffle.TransactionDetails
      ): Promise<string>;
      estimateGas(
        _topupTokenPriceFactorBIPS: number | BN | string,
        txDetails?: Truffle.TransactionDetails
      ): Promise<number>;
    };

    supportsInterface(
      _interfaceId: string,
      txDetails?: Truffle.TransactionDetails
    ): Promise<boolean>;

    token(txDetails?: Truffle.TransactionDetails): Promise<string>;

    topupCollateralRatioBIPS(
      txDetails?: Truffle.TransactionDetails
    ): Promise<BN>;

    topupTokenPriceFactorBIPS(
      txDetails?: Truffle.TransactionDetails
    ): Promise<BN>;

    totalCollateral(txDetails?: Truffle.TransactionDetails): Promise<BN>;

    totalFAssetFeeDebt(txDetails?: Truffle.TransactionDetails): Promise<BN>;

    totalFAssetFees(txDetails?: Truffle.TransactionDetails): Promise<BN>;

    transferableTokensOf(
      _account: string,
      txDetails?: Truffle.TransactionDetails
    ): Promise<BN>;

    upgradeWNatContract: {
      (_newWNat: string, txDetails?: Truffle.TransactionDetails): Promise<
        Truffle.TransactionResponse<AllEvents>
      >;
      call(
        _newWNat: string,
        txDetails?: Truffle.TransactionDetails
      ): Promise<void>;
      sendTransaction(
        _newWNat: string,
        txDetails?: Truffle.TransactionDetails
      ): Promise<string>;
      estimateGas(
        _newWNat: string,
        txDetails?: Truffle.TransactionDetails
      ): Promise<number>;
    };

    virtualFAssetOf(
      _account: string,
      txDetails?: Truffle.TransactionDetails
    ): Promise<BN>;

    wNat(txDetails?: Truffle.TransactionDetails): Promise<string>;

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
        _fAssets: number | BN | string,
        txDetails?: Truffle.TransactionDetails
      ): Promise<Truffle.TransactionResponse<AllEvents>>;
      call(
        _fAssets: number | BN | string,
        txDetails?: Truffle.TransactionDetails
      ): Promise<void>;
      sendTransaction(
        _fAssets: number | BN | string,
        txDetails?: Truffle.TransactionDetails
      ): Promise<string>;
      estimateGas(
        _fAssets: number | BN | string,
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
