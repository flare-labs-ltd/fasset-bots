/* Autogenerated file. Do not edit manually. */
/* tslint:disable */
/* eslint-disable */

import BN from "bn.js";
import { EventData, PastEventOptions } from "web3-eth-contract";

export interface IAgentVaultContract
  extends Truffle.Contract<IAgentVaultInstance> {
  "new"(meta?: Truffle.TransactionDetails): Promise<IAgentVaultInstance>;
}

type AllEvents = never;

export interface IAgentVaultInstance extends Truffle.ContractInstance {
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

  collateralDeposited: {
    (_token: string, txDetails?: Truffle.TransactionDetails): Promise<
      Truffle.TransactionResponse<AllEvents>
    >;
    call(_token: string, txDetails?: Truffle.TransactionDetails): Promise<void>;
    sendTransaction(
      _token: string,
      txDetails?: Truffle.TransactionDetails
    ): Promise<string>;
    estimateGas(
      _token: string,
      txDetails?: Truffle.TransactionDetails
    ): Promise<number>;
  };

  delegate: {
    (
      _token: string,
      _to: string,
      _bips: number | BN | string,
      txDetails?: Truffle.TransactionDetails
    ): Promise<Truffle.TransactionResponse<AllEvents>>;
    call(
      _token: string,
      _to: string,
      _bips: number | BN | string,
      txDetails?: Truffle.TransactionDetails
    ): Promise<void>;
    sendTransaction(
      _token: string,
      _to: string,
      _bips: number | BN | string,
      txDetails?: Truffle.TransactionDetails
    ): Promise<string>;
    estimateGas(
      _token: string,
      _to: string,
      _bips: number | BN | string,
      txDetails?: Truffle.TransactionDetails
    ): Promise<number>;
  };

  delegateGovernance: {
    (_to: string, txDetails?: Truffle.TransactionDetails): Promise<
      Truffle.TransactionResponse<AllEvents>
    >;
    call(_to: string, txDetails?: Truffle.TransactionDetails): Promise<void>;
    sendTransaction(
      _to: string,
      txDetails?: Truffle.TransactionDetails
    ): Promise<string>;
    estimateGas(
      _to: string,
      txDetails?: Truffle.TransactionDetails
    ): Promise<number>;
  };

  depositCollateral: {
    (
      _token: string,
      _amount: number | BN | string,
      txDetails?: Truffle.TransactionDetails
    ): Promise<Truffle.TransactionResponse<AllEvents>>;
    call(
      _token: string,
      _amount: number | BN | string,
      txDetails?: Truffle.TransactionDetails
    ): Promise<void>;
    sendTransaction(
      _token: string,
      _amount: number | BN | string,
      txDetails?: Truffle.TransactionDetails
    ): Promise<string>;
    estimateGas(
      _token: string,
      _amount: number | BN | string,
      txDetails?: Truffle.TransactionDetails
    ): Promise<number>;
  };

  depositNat: {
    (txDetails?: Truffle.TransactionDetails): Promise<
      Truffle.TransactionResponse<AllEvents>
    >;
    call(txDetails?: Truffle.TransactionDetails): Promise<void>;
    sendTransaction(txDetails?: Truffle.TransactionDetails): Promise<string>;
    estimateGas(txDetails?: Truffle.TransactionDetails): Promise<number>;
  };

  destroy: {
    (txDetails?: Truffle.TransactionDetails): Promise<
      Truffle.TransactionResponse<AllEvents>
    >;
    call(txDetails?: Truffle.TransactionDetails): Promise<void>;
    sendTransaction(txDetails?: Truffle.TransactionDetails): Promise<string>;
    estimateGas(txDetails?: Truffle.TransactionDetails): Promise<number>;
  };

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

  owner(txDetails?: Truffle.TransactionDetails): Promise<string>;

  payout: {
    (
      _token: string,
      _recipient: string,
      _amount: number | BN | string,
      txDetails?: Truffle.TransactionDetails
    ): Promise<Truffle.TransactionResponse<AllEvents>>;
    call(
      _token: string,
      _recipient: string,
      _amount: number | BN | string,
      txDetails?: Truffle.TransactionDetails
    ): Promise<void>;
    sendTransaction(
      _token: string,
      _recipient: string,
      _amount: number | BN | string,
      txDetails?: Truffle.TransactionDetails
    ): Promise<string>;
    estimateGas(
      _token: string,
      _recipient: string,
      _amount: number | BN | string,
      txDetails?: Truffle.TransactionDetails
    ): Promise<number>;
  };

  payoutNAT: {
    (
      _recipient: string,
      _amount: number | BN | string,
      txDetails?: Truffle.TransactionDetails
    ): Promise<Truffle.TransactionResponse<AllEvents>>;
    call(
      _recipient: string,
      _amount: number | BN | string,
      txDetails?: Truffle.TransactionDetails
    ): Promise<void>;
    sendTransaction(
      _recipient: string,
      _amount: number | BN | string,
      txDetails?: Truffle.TransactionDetails
    ): Promise<string>;
    estimateGas(
      _recipient: string,
      _amount: number | BN | string,
      txDetails?: Truffle.TransactionDetails
    ): Promise<number>;
  };

  revokeDelegationAt: {
    (
      _token: string,
      _who: string,
      _blockNumber: number | BN | string,
      txDetails?: Truffle.TransactionDetails
    ): Promise<Truffle.TransactionResponse<AllEvents>>;
    call(
      _token: string,
      _who: string,
      _blockNumber: number | BN | string,
      txDetails?: Truffle.TransactionDetails
    ): Promise<void>;
    sendTransaction(
      _token: string,
      _who: string,
      _blockNumber: number | BN | string,
      txDetails?: Truffle.TransactionDetails
    ): Promise<string>;
    estimateGas(
      _token: string,
      _who: string,
      _blockNumber: number | BN | string,
      txDetails?: Truffle.TransactionDetails
    ): Promise<number>;
  };

  setFtsoAutoClaiming: {
    (
      _claimSetupManager: string,
      _executors: string[],
      _allowedRecipients: string[],
      txDetails?: Truffle.TransactionDetails
    ): Promise<Truffle.TransactionResponse<AllEvents>>;
    call(
      _claimSetupManager: string,
      _executors: string[],
      _allowedRecipients: string[],
      txDetails?: Truffle.TransactionDetails
    ): Promise<void>;
    sendTransaction(
      _claimSetupManager: string,
      _executors: string[],
      _allowedRecipients: string[],
      txDetails?: Truffle.TransactionDetails
    ): Promise<string>;
    estimateGas(
      _claimSetupManager: string,
      _executors: string[],
      _allowedRecipients: string[],
      txDetails?: Truffle.TransactionDetails
    ): Promise<number>;
  };

  transferExternalToken: {
    (
      _token: string,
      _amount: number | BN | string,
      txDetails?: Truffle.TransactionDetails
    ): Promise<Truffle.TransactionResponse<AllEvents>>;
    call(
      _token: string,
      _amount: number | BN | string,
      txDetails?: Truffle.TransactionDetails
    ): Promise<void>;
    sendTransaction(
      _token: string,
      _amount: number | BN | string,
      txDetails?: Truffle.TransactionDetails
    ): Promise<string>;
    estimateGas(
      _token: string,
      _amount: number | BN | string,
      txDetails?: Truffle.TransactionDetails
    ): Promise<number>;
  };

  undelegateAll: {
    (_token: string, txDetails?: Truffle.TransactionDetails): Promise<
      Truffle.TransactionResponse<AllEvents>
    >;
    call(_token: string, txDetails?: Truffle.TransactionDetails): Promise<void>;
    sendTransaction(
      _token: string,
      txDetails?: Truffle.TransactionDetails
    ): Promise<string>;
    estimateGas(
      _token: string,
      txDetails?: Truffle.TransactionDetails
    ): Promise<number>;
  };

  undelegateGovernance: {
    (txDetails?: Truffle.TransactionDetails): Promise<
      Truffle.TransactionResponse<AllEvents>
    >;
    call(txDetails?: Truffle.TransactionDetails): Promise<void>;
    sendTransaction(txDetails?: Truffle.TransactionDetails): Promise<string>;
    estimateGas(txDetails?: Truffle.TransactionDetails): Promise<number>;
  };

  upgradeWNatContract: {
    (newWNat: string, txDetails?: Truffle.TransactionDetails): Promise<
      Truffle.TransactionResponse<AllEvents>
    >;
    call(
      newWNat: string,
      txDetails?: Truffle.TransactionDetails
    ): Promise<void>;
    sendTransaction(
      newWNat: string,
      txDetails?: Truffle.TransactionDetails
    ): Promise<string>;
    estimateGas(
      newWNat: string,
      txDetails?: Truffle.TransactionDetails
    ): Promise<number>;
  };

  wNat(txDetails?: Truffle.TransactionDetails): Promise<string>;

  withdrawCollateral: {
    (
      _token: string,
      _amount: number | BN | string,
      _recipient: string,
      txDetails?: Truffle.TransactionDetails
    ): Promise<Truffle.TransactionResponse<AllEvents>>;
    call(
      _token: string,
      _amount: number | BN | string,
      _recipient: string,
      txDetails?: Truffle.TransactionDetails
    ): Promise<void>;
    sendTransaction(
      _token: string,
      _amount: number | BN | string,
      _recipient: string,
      txDetails?: Truffle.TransactionDetails
    ): Promise<string>;
    estimateGas(
      _token: string,
      _amount: number | BN | string,
      _recipient: string,
      txDetails?: Truffle.TransactionDetails
    ): Promise<number>;
  };

  withdrawNat: {
    (
      _amount: number | BN | string,
      _recipient: string,
      txDetails?: Truffle.TransactionDetails
    ): Promise<Truffle.TransactionResponse<AllEvents>>;
    call(
      _amount: number | BN | string,
      _recipient: string,
      txDetails?: Truffle.TransactionDetails
    ): Promise<void>;
    sendTransaction(
      _amount: number | BN | string,
      _recipient: string,
      txDetails?: Truffle.TransactionDetails
    ): Promise<string>;
    estimateGas(
      _amount: number | BN | string,
      _recipient: string,
      txDetails?: Truffle.TransactionDetails
    ): Promise<number>;
  };

  methods: {
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

    collateralDeposited: {
      (_token: string, txDetails?: Truffle.TransactionDetails): Promise<
        Truffle.TransactionResponse<AllEvents>
      >;
      call(
        _token: string,
        txDetails?: Truffle.TransactionDetails
      ): Promise<void>;
      sendTransaction(
        _token: string,
        txDetails?: Truffle.TransactionDetails
      ): Promise<string>;
      estimateGas(
        _token: string,
        txDetails?: Truffle.TransactionDetails
      ): Promise<number>;
    };

    delegate: {
      (
        _token: string,
        _to: string,
        _bips: number | BN | string,
        txDetails?: Truffle.TransactionDetails
      ): Promise<Truffle.TransactionResponse<AllEvents>>;
      call(
        _token: string,
        _to: string,
        _bips: number | BN | string,
        txDetails?: Truffle.TransactionDetails
      ): Promise<void>;
      sendTransaction(
        _token: string,
        _to: string,
        _bips: number | BN | string,
        txDetails?: Truffle.TransactionDetails
      ): Promise<string>;
      estimateGas(
        _token: string,
        _to: string,
        _bips: number | BN | string,
        txDetails?: Truffle.TransactionDetails
      ): Promise<number>;
    };

    delegateGovernance: {
      (_to: string, txDetails?: Truffle.TransactionDetails): Promise<
        Truffle.TransactionResponse<AllEvents>
      >;
      call(_to: string, txDetails?: Truffle.TransactionDetails): Promise<void>;
      sendTransaction(
        _to: string,
        txDetails?: Truffle.TransactionDetails
      ): Promise<string>;
      estimateGas(
        _to: string,
        txDetails?: Truffle.TransactionDetails
      ): Promise<number>;
    };

    depositCollateral: {
      (
        _token: string,
        _amount: number | BN | string,
        txDetails?: Truffle.TransactionDetails
      ): Promise<Truffle.TransactionResponse<AllEvents>>;
      call(
        _token: string,
        _amount: number | BN | string,
        txDetails?: Truffle.TransactionDetails
      ): Promise<void>;
      sendTransaction(
        _token: string,
        _amount: number | BN | string,
        txDetails?: Truffle.TransactionDetails
      ): Promise<string>;
      estimateGas(
        _token: string,
        _amount: number | BN | string,
        txDetails?: Truffle.TransactionDetails
      ): Promise<number>;
    };

    depositNat: {
      (txDetails?: Truffle.TransactionDetails): Promise<
        Truffle.TransactionResponse<AllEvents>
      >;
      call(txDetails?: Truffle.TransactionDetails): Promise<void>;
      sendTransaction(txDetails?: Truffle.TransactionDetails): Promise<string>;
      estimateGas(txDetails?: Truffle.TransactionDetails): Promise<number>;
    };

    destroy: {
      (txDetails?: Truffle.TransactionDetails): Promise<
        Truffle.TransactionResponse<AllEvents>
      >;
      call(txDetails?: Truffle.TransactionDetails): Promise<void>;
      sendTransaction(txDetails?: Truffle.TransactionDetails): Promise<string>;
      estimateGas(txDetails?: Truffle.TransactionDetails): Promise<number>;
    };

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

    owner(txDetails?: Truffle.TransactionDetails): Promise<string>;

    payout: {
      (
        _token: string,
        _recipient: string,
        _amount: number | BN | string,
        txDetails?: Truffle.TransactionDetails
      ): Promise<Truffle.TransactionResponse<AllEvents>>;
      call(
        _token: string,
        _recipient: string,
        _amount: number | BN | string,
        txDetails?: Truffle.TransactionDetails
      ): Promise<void>;
      sendTransaction(
        _token: string,
        _recipient: string,
        _amount: number | BN | string,
        txDetails?: Truffle.TransactionDetails
      ): Promise<string>;
      estimateGas(
        _token: string,
        _recipient: string,
        _amount: number | BN | string,
        txDetails?: Truffle.TransactionDetails
      ): Promise<number>;
    };

    payoutNAT: {
      (
        _recipient: string,
        _amount: number | BN | string,
        txDetails?: Truffle.TransactionDetails
      ): Promise<Truffle.TransactionResponse<AllEvents>>;
      call(
        _recipient: string,
        _amount: number | BN | string,
        txDetails?: Truffle.TransactionDetails
      ): Promise<void>;
      sendTransaction(
        _recipient: string,
        _amount: number | BN | string,
        txDetails?: Truffle.TransactionDetails
      ): Promise<string>;
      estimateGas(
        _recipient: string,
        _amount: number | BN | string,
        txDetails?: Truffle.TransactionDetails
      ): Promise<number>;
    };

    revokeDelegationAt: {
      (
        _token: string,
        _who: string,
        _blockNumber: number | BN | string,
        txDetails?: Truffle.TransactionDetails
      ): Promise<Truffle.TransactionResponse<AllEvents>>;
      call(
        _token: string,
        _who: string,
        _blockNumber: number | BN | string,
        txDetails?: Truffle.TransactionDetails
      ): Promise<void>;
      sendTransaction(
        _token: string,
        _who: string,
        _blockNumber: number | BN | string,
        txDetails?: Truffle.TransactionDetails
      ): Promise<string>;
      estimateGas(
        _token: string,
        _who: string,
        _blockNumber: number | BN | string,
        txDetails?: Truffle.TransactionDetails
      ): Promise<number>;
    };

    setFtsoAutoClaiming: {
      (
        _claimSetupManager: string,
        _executors: string[],
        _allowedRecipients: string[],
        txDetails?: Truffle.TransactionDetails
      ): Promise<Truffle.TransactionResponse<AllEvents>>;
      call(
        _claimSetupManager: string,
        _executors: string[],
        _allowedRecipients: string[],
        txDetails?: Truffle.TransactionDetails
      ): Promise<void>;
      sendTransaction(
        _claimSetupManager: string,
        _executors: string[],
        _allowedRecipients: string[],
        txDetails?: Truffle.TransactionDetails
      ): Promise<string>;
      estimateGas(
        _claimSetupManager: string,
        _executors: string[],
        _allowedRecipients: string[],
        txDetails?: Truffle.TransactionDetails
      ): Promise<number>;
    };

    transferExternalToken: {
      (
        _token: string,
        _amount: number | BN | string,
        txDetails?: Truffle.TransactionDetails
      ): Promise<Truffle.TransactionResponse<AllEvents>>;
      call(
        _token: string,
        _amount: number | BN | string,
        txDetails?: Truffle.TransactionDetails
      ): Promise<void>;
      sendTransaction(
        _token: string,
        _amount: number | BN | string,
        txDetails?: Truffle.TransactionDetails
      ): Promise<string>;
      estimateGas(
        _token: string,
        _amount: number | BN | string,
        txDetails?: Truffle.TransactionDetails
      ): Promise<number>;
    };

    undelegateAll: {
      (_token: string, txDetails?: Truffle.TransactionDetails): Promise<
        Truffle.TransactionResponse<AllEvents>
      >;
      call(
        _token: string,
        txDetails?: Truffle.TransactionDetails
      ): Promise<void>;
      sendTransaction(
        _token: string,
        txDetails?: Truffle.TransactionDetails
      ): Promise<string>;
      estimateGas(
        _token: string,
        txDetails?: Truffle.TransactionDetails
      ): Promise<number>;
    };

    undelegateGovernance: {
      (txDetails?: Truffle.TransactionDetails): Promise<
        Truffle.TransactionResponse<AllEvents>
      >;
      call(txDetails?: Truffle.TransactionDetails): Promise<void>;
      sendTransaction(txDetails?: Truffle.TransactionDetails): Promise<string>;
      estimateGas(txDetails?: Truffle.TransactionDetails): Promise<number>;
    };

    upgradeWNatContract: {
      (newWNat: string, txDetails?: Truffle.TransactionDetails): Promise<
        Truffle.TransactionResponse<AllEvents>
      >;
      call(
        newWNat: string,
        txDetails?: Truffle.TransactionDetails
      ): Promise<void>;
      sendTransaction(
        newWNat: string,
        txDetails?: Truffle.TransactionDetails
      ): Promise<string>;
      estimateGas(
        newWNat: string,
        txDetails?: Truffle.TransactionDetails
      ): Promise<number>;
    };

    wNat(txDetails?: Truffle.TransactionDetails): Promise<string>;

    withdrawCollateral: {
      (
        _token: string,
        _amount: number | BN | string,
        _recipient: string,
        txDetails?: Truffle.TransactionDetails
      ): Promise<Truffle.TransactionResponse<AllEvents>>;
      call(
        _token: string,
        _amount: number | BN | string,
        _recipient: string,
        txDetails?: Truffle.TransactionDetails
      ): Promise<void>;
      sendTransaction(
        _token: string,
        _amount: number | BN | string,
        _recipient: string,
        txDetails?: Truffle.TransactionDetails
      ): Promise<string>;
      estimateGas(
        _token: string,
        _amount: number | BN | string,
        _recipient: string,
        txDetails?: Truffle.TransactionDetails
      ): Promise<number>;
    };

    withdrawNat: {
      (
        _amount: number | BN | string,
        _recipient: string,
        txDetails?: Truffle.TransactionDetails
      ): Promise<Truffle.TransactionResponse<AllEvents>>;
      call(
        _amount: number | BN | string,
        _recipient: string,
        txDetails?: Truffle.TransactionDetails
      ): Promise<void>;
      sendTransaction(
        _amount: number | BN | string,
        _recipient: string,
        txDetails?: Truffle.TransactionDetails
      ): Promise<string>;
      estimateGas(
        _amount: number | BN | string,
        _recipient: string,
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
