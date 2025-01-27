/* Autogenerated file. Do not edit manually. */
/* tslint:disable */
/* eslint-disable */

import type { Truffle } from "./types";

import BN from "bn.js";
import { EventData, PastEventOptions } from "web3-eth-contract";

export interface WhitelistContract extends Truffle.Contract<WhitelistInstance> {
  "new"(
    _governanceSettings: string,
    _initialGovernance: string,
    _supportsRevoke: boolean,
    meta?: Truffle.TransactionDetails
  ): Promise<WhitelistInstance>;
}

export interface GovernanceCallTimelocked {
  name: "GovernanceCallTimelocked";
  args: {
    encodedCall: string;
    encodedCallHash: string;
    allowedAfterTimestamp: BN;
    0: string;
    1: string;
    2: BN;
  };
}

export interface GovernanceInitialised {
  name: "GovernanceInitialised";
  args: {
    initialGovernance: string;
    0: string;
  };
}

export interface GovernedProductionModeEntered {
  name: "GovernedProductionModeEntered";
  args: {
    governanceSettings: string;
    0: string;
  };
}

export interface ManagerChanged {
  name: "ManagerChanged";
  args: {
    manager: string;
    0: string;
  };
}

export interface TimelockedGovernanceCallCanceled {
  name: "TimelockedGovernanceCallCanceled";
  args: {
    encodedCallHash: string;
    0: string;
  };
}

export interface TimelockedGovernanceCallExecuted {
  name: "TimelockedGovernanceCallExecuted";
  args: {
    encodedCallHash: string;
    0: string;
  };
}

export interface Whitelisted {
  name: "Whitelisted";
  args: {
    value: string;
    0: string;
  };
}

export interface WhitelistingRevoked {
  name: "WhitelistingRevoked";
  args: {
    value: string;
    0: string;
  };
}

export type AllEvents =
  | GovernanceCallTimelocked
  | GovernanceInitialised
  | GovernedProductionModeEntered
  | ManagerChanged
  | TimelockedGovernanceCallCanceled
  | TimelockedGovernanceCallExecuted
  | Whitelisted
  | WhitelistingRevoked;

export interface WhitelistInstance extends Truffle.ContractInstance {
  addAddressToWhitelist: {
    (_address: string, txDetails?: Truffle.TransactionDetails): Promise<
      Truffle.TransactionResponse<AllEvents>
    >;
    call(
      _address: string,
      txDetails?: Truffle.TransactionDetails
    ): Promise<void>;
    sendTransaction(
      _address: string,
      txDetails?: Truffle.TransactionDetails
    ): Promise<string>;
    estimateGas(
      _address: string,
      txDetails?: Truffle.TransactionDetails
    ): Promise<number>;
  };

  addAddressesToWhitelist: {
    (_addresses: string[], txDetails?: Truffle.TransactionDetails): Promise<
      Truffle.TransactionResponse<AllEvents>
    >;
    call(
      _addresses: string[],
      txDetails?: Truffle.TransactionDetails
    ): Promise<void>;
    sendTransaction(
      _addresses: string[],
      txDetails?: Truffle.TransactionDetails
    ): Promise<string>;
    estimateGas(
      _addresses: string[],
      txDetails?: Truffle.TransactionDetails
    ): Promise<number>;
  };

  allowAll(txDetails?: Truffle.TransactionDetails): Promise<boolean>;

  cancelGovernanceCall: {
    (_encodedCall: string, txDetails?: Truffle.TransactionDetails): Promise<
      Truffle.TransactionResponse<AllEvents>
    >;
    call(
      _encodedCall: string,
      txDetails?: Truffle.TransactionDetails
    ): Promise<void>;
    sendTransaction(
      _encodedCall: string,
      txDetails?: Truffle.TransactionDetails
    ): Promise<string>;
    estimateGas(
      _encodedCall: string,
      txDetails?: Truffle.TransactionDetails
    ): Promise<number>;
  };

  executeGovernanceCall: {
    (_encodedCall: string, txDetails?: Truffle.TransactionDetails): Promise<
      Truffle.TransactionResponse<AllEvents>
    >;
    call(
      _encodedCall: string,
      txDetails?: Truffle.TransactionDetails
    ): Promise<void>;
    sendTransaction(
      _encodedCall: string,
      txDetails?: Truffle.TransactionDetails
    ): Promise<string>;
    estimateGas(
      _encodedCall: string,
      txDetails?: Truffle.TransactionDetails
    ): Promise<number>;
  };

  governance(txDetails?: Truffle.TransactionDetails): Promise<string>;

  governanceSettings(txDetails?: Truffle.TransactionDetails): Promise<string>;

  initialise: {
    (
      _governanceSettings: string,
      _initialGovernance: string,
      txDetails?: Truffle.TransactionDetails
    ): Promise<Truffle.TransactionResponse<AllEvents>>;
    call(
      _governanceSettings: string,
      _initialGovernance: string,
      txDetails?: Truffle.TransactionDetails
    ): Promise<void>;
    sendTransaction(
      _governanceSettings: string,
      _initialGovernance: string,
      txDetails?: Truffle.TransactionDetails
    ): Promise<string>;
    estimateGas(
      _governanceSettings: string,
      _initialGovernance: string,
      txDetails?: Truffle.TransactionDetails
    ): Promise<number>;
  };

  isExecutor(
    _address: string,
    txDetails?: Truffle.TransactionDetails
  ): Promise<boolean>;

  isWhitelisted(
    _address: string,
    txDetails?: Truffle.TransactionDetails
  ): Promise<boolean>;

  manager(txDetails?: Truffle.TransactionDetails): Promise<string>;

  productionMode(txDetails?: Truffle.TransactionDetails): Promise<boolean>;

  revokeAddress: {
    (_address: string, txDetails?: Truffle.TransactionDetails): Promise<
      Truffle.TransactionResponse<AllEvents>
    >;
    call(
      _address: string,
      txDetails?: Truffle.TransactionDetails
    ): Promise<void>;
    sendTransaction(
      _address: string,
      txDetails?: Truffle.TransactionDetails
    ): Promise<string>;
    estimateGas(
      _address: string,
      txDetails?: Truffle.TransactionDetails
    ): Promise<number>;
  };

  setAllowAll: {
    (_allowAll: boolean, txDetails?: Truffle.TransactionDetails): Promise<
      Truffle.TransactionResponse<AllEvents>
    >;
    call(
      _allowAll: boolean,
      txDetails?: Truffle.TransactionDetails
    ): Promise<void>;
    sendTransaction(
      _allowAll: boolean,
      txDetails?: Truffle.TransactionDetails
    ): Promise<string>;
    estimateGas(
      _allowAll: boolean,
      txDetails?: Truffle.TransactionDetails
    ): Promise<number>;
  };

  setManager: {
    (_manager: string, txDetails?: Truffle.TransactionDetails): Promise<
      Truffle.TransactionResponse<AllEvents>
    >;
    call(
      _manager: string,
      txDetails?: Truffle.TransactionDetails
    ): Promise<void>;
    sendTransaction(
      _manager: string,
      txDetails?: Truffle.TransactionDetails
    ): Promise<string>;
    estimateGas(
      _manager: string,
      txDetails?: Truffle.TransactionDetails
    ): Promise<number>;
  };

  supportsInterface(
    _interfaceId: string,
    txDetails?: Truffle.TransactionDetails
  ): Promise<boolean>;

  supportsRevoke(txDetails?: Truffle.TransactionDetails): Promise<boolean>;

  switchToProductionMode: {
    (txDetails?: Truffle.TransactionDetails): Promise<
      Truffle.TransactionResponse<AllEvents>
    >;
    call(txDetails?: Truffle.TransactionDetails): Promise<void>;
    sendTransaction(txDetails?: Truffle.TransactionDetails): Promise<string>;
    estimateGas(txDetails?: Truffle.TransactionDetails): Promise<number>;
  };

  methods: {
    addAddressToWhitelist: {
      (_address: string, txDetails?: Truffle.TransactionDetails): Promise<
        Truffle.TransactionResponse<AllEvents>
      >;
      call(
        _address: string,
        txDetails?: Truffle.TransactionDetails
      ): Promise<void>;
      sendTransaction(
        _address: string,
        txDetails?: Truffle.TransactionDetails
      ): Promise<string>;
      estimateGas(
        _address: string,
        txDetails?: Truffle.TransactionDetails
      ): Promise<number>;
    };

    addAddressesToWhitelist: {
      (_addresses: string[], txDetails?: Truffle.TransactionDetails): Promise<
        Truffle.TransactionResponse<AllEvents>
      >;
      call(
        _addresses: string[],
        txDetails?: Truffle.TransactionDetails
      ): Promise<void>;
      sendTransaction(
        _addresses: string[],
        txDetails?: Truffle.TransactionDetails
      ): Promise<string>;
      estimateGas(
        _addresses: string[],
        txDetails?: Truffle.TransactionDetails
      ): Promise<number>;
    };

    allowAll(txDetails?: Truffle.TransactionDetails): Promise<boolean>;

    cancelGovernanceCall: {
      (_encodedCall: string, txDetails?: Truffle.TransactionDetails): Promise<
        Truffle.TransactionResponse<AllEvents>
      >;
      call(
        _encodedCall: string,
        txDetails?: Truffle.TransactionDetails
      ): Promise<void>;
      sendTransaction(
        _encodedCall: string,
        txDetails?: Truffle.TransactionDetails
      ): Promise<string>;
      estimateGas(
        _encodedCall: string,
        txDetails?: Truffle.TransactionDetails
      ): Promise<number>;
    };

    executeGovernanceCall: {
      (_encodedCall: string, txDetails?: Truffle.TransactionDetails): Promise<
        Truffle.TransactionResponse<AllEvents>
      >;
      call(
        _encodedCall: string,
        txDetails?: Truffle.TransactionDetails
      ): Promise<void>;
      sendTransaction(
        _encodedCall: string,
        txDetails?: Truffle.TransactionDetails
      ): Promise<string>;
      estimateGas(
        _encodedCall: string,
        txDetails?: Truffle.TransactionDetails
      ): Promise<number>;
    };

    governance(txDetails?: Truffle.TransactionDetails): Promise<string>;

    governanceSettings(txDetails?: Truffle.TransactionDetails): Promise<string>;

    initialise: {
      (
        _governanceSettings: string,
        _initialGovernance: string,
        txDetails?: Truffle.TransactionDetails
      ): Promise<Truffle.TransactionResponse<AllEvents>>;
      call(
        _governanceSettings: string,
        _initialGovernance: string,
        txDetails?: Truffle.TransactionDetails
      ): Promise<void>;
      sendTransaction(
        _governanceSettings: string,
        _initialGovernance: string,
        txDetails?: Truffle.TransactionDetails
      ): Promise<string>;
      estimateGas(
        _governanceSettings: string,
        _initialGovernance: string,
        txDetails?: Truffle.TransactionDetails
      ): Promise<number>;
    };

    isExecutor(
      _address: string,
      txDetails?: Truffle.TransactionDetails
    ): Promise<boolean>;

    isWhitelisted(
      _address: string,
      txDetails?: Truffle.TransactionDetails
    ): Promise<boolean>;

    manager(txDetails?: Truffle.TransactionDetails): Promise<string>;

    productionMode(txDetails?: Truffle.TransactionDetails): Promise<boolean>;

    revokeAddress: {
      (_address: string, txDetails?: Truffle.TransactionDetails): Promise<
        Truffle.TransactionResponse<AllEvents>
      >;
      call(
        _address: string,
        txDetails?: Truffle.TransactionDetails
      ): Promise<void>;
      sendTransaction(
        _address: string,
        txDetails?: Truffle.TransactionDetails
      ): Promise<string>;
      estimateGas(
        _address: string,
        txDetails?: Truffle.TransactionDetails
      ): Promise<number>;
    };

    setAllowAll: {
      (_allowAll: boolean, txDetails?: Truffle.TransactionDetails): Promise<
        Truffle.TransactionResponse<AllEvents>
      >;
      call(
        _allowAll: boolean,
        txDetails?: Truffle.TransactionDetails
      ): Promise<void>;
      sendTransaction(
        _allowAll: boolean,
        txDetails?: Truffle.TransactionDetails
      ): Promise<string>;
      estimateGas(
        _allowAll: boolean,
        txDetails?: Truffle.TransactionDetails
      ): Promise<number>;
    };

    setManager: {
      (_manager: string, txDetails?: Truffle.TransactionDetails): Promise<
        Truffle.TransactionResponse<AllEvents>
      >;
      call(
        _manager: string,
        txDetails?: Truffle.TransactionDetails
      ): Promise<void>;
      sendTransaction(
        _manager: string,
        txDetails?: Truffle.TransactionDetails
      ): Promise<string>;
      estimateGas(
        _manager: string,
        txDetails?: Truffle.TransactionDetails
      ): Promise<number>;
    };

    supportsInterface(
      _interfaceId: string,
      txDetails?: Truffle.TransactionDetails
    ): Promise<boolean>;

    supportsRevoke(txDetails?: Truffle.TransactionDetails): Promise<boolean>;

    switchToProductionMode: {
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
