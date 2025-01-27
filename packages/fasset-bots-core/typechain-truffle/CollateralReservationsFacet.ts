/* Autogenerated file. Do not edit manually. */
/* tslint:disable */
/* eslint-disable */

import type { Truffle } from "./types";

import BN from "bn.js";
import { EventData, PastEventOptions } from "web3-eth-contract";

export interface CollateralReservationsFacetContract
  extends Truffle.Contract<CollateralReservationsFacetInstance> {
  "new"(
    meta?: Truffle.TransactionDetails
  ): Promise<CollateralReservationsFacetInstance>;
}

export interface CollateralReservationCancelled {
  name: "CollateralReservationCancelled";
  args: {
    agentVault: string;
    minter: string;
    collateralReservationId: BN;
    0: string;
    1: string;
    2: BN;
  };
}

export interface CollateralReservationDeleted {
  name: "CollateralReservationDeleted";
  args: {
    agentVault: string;
    minter: string;
    collateralReservationId: BN;
    reservedAmountUBA: BN;
    0: string;
    1: string;
    2: BN;
    3: BN;
  };
}

export interface CollateralReservationRejected {
  name: "CollateralReservationRejected";
  args: {
    agentVault: string;
    minter: string;
    collateralReservationId: BN;
    0: string;
    1: string;
    2: BN;
  };
}

export interface CollateralReserved {
  name: "CollateralReserved";
  args: {
    agentVault: string;
    minter: string;
    collateralReservationId: BN;
    valueUBA: BN;
    feeUBA: BN;
    firstUnderlyingBlock: BN;
    lastUnderlyingBlock: BN;
    lastUnderlyingTimestamp: BN;
    paymentAddress: string;
    paymentReference: string;
    executor: string;
    executorFeeNatWei: BN;
    0: string;
    1: string;
    2: BN;
    3: BN;
    4: BN;
    5: BN;
    6: BN;
    7: BN;
    8: string;
    9: string;
    10: string;
    11: BN;
  };
}

export interface HandshakeRequired {
  name: "HandshakeRequired";
  args: {
    agentVault: string;
    minter: string;
    collateralReservationId: BN;
    minterUnderlyingAddresses: string[];
    valueUBA: BN;
    feeUBA: BN;
    0: string;
    1: string;
    2: BN;
    3: string[];
    4: BN;
    5: BN;
  };
}

export interface MintingPaymentDefault {
  name: "MintingPaymentDefault";
  args: {
    agentVault: string;
    minter: string;
    collateralReservationId: BN;
    reservedAmountUBA: BN;
    0: string;
    1: string;
    2: BN;
    3: BN;
  };
}

export type AllEvents =
  | CollateralReservationCancelled
  | CollateralReservationDeleted
  | CollateralReservationRejected
  | CollateralReserved
  | HandshakeRequired
  | MintingPaymentDefault;

export interface CollateralReservationsFacetInstance
  extends Truffle.ContractInstance {
  approveCollateralReservation: {
    (
      _collateralReservationId: number | BN | string,
      txDetails?: Truffle.TransactionDetails
    ): Promise<Truffle.TransactionResponse<AllEvents>>;
    call(
      _collateralReservationId: number | BN | string,
      txDetails?: Truffle.TransactionDetails
    ): Promise<void>;
    sendTransaction(
      _collateralReservationId: number | BN | string,
      txDetails?: Truffle.TransactionDetails
    ): Promise<string>;
    estimateGas(
      _collateralReservationId: number | BN | string,
      txDetails?: Truffle.TransactionDetails
    ): Promise<number>;
  };

  cancelCollateralReservation: {
    (
      _collateralReservationId: number | BN | string,
      txDetails?: Truffle.TransactionDetails
    ): Promise<Truffle.TransactionResponse<AllEvents>>;
    call(
      _collateralReservationId: number | BN | string,
      txDetails?: Truffle.TransactionDetails
    ): Promise<void>;
    sendTransaction(
      _collateralReservationId: number | BN | string,
      txDetails?: Truffle.TransactionDetails
    ): Promise<string>;
    estimateGas(
      _collateralReservationId: number | BN | string,
      txDetails?: Truffle.TransactionDetails
    ): Promise<number>;
  };

  collateralReservationFee(
    _lots: number | BN | string,
    txDetails?: Truffle.TransactionDetails
  ): Promise<BN>;

  mintingPaymentDefault: {
    (
      _proof: {
        merkleProof: string[];
        data: {
          attestationType: string;
          sourceId: string;
          votingRound: number | BN | string;
          lowestUsedTimestamp: number | BN | string;
          requestBody: {
            minimalBlockNumber: number | BN | string;
            deadlineBlockNumber: number | BN | string;
            deadlineTimestamp: number | BN | string;
            destinationAddressHash: string;
            amount: number | BN | string;
            standardPaymentReference: string;
            checkSourceAddresses: boolean;
            sourceAddressesRoot: string;
          };
          responseBody: {
            minimalBlockTimestamp: number | BN | string;
            firstOverflowBlockNumber: number | BN | string;
            firstOverflowBlockTimestamp: number | BN | string;
          };
        };
      },
      _collateralReservationId: number | BN | string,
      txDetails?: Truffle.TransactionDetails
    ): Promise<Truffle.TransactionResponse<AllEvents>>;
    call(
      _proof: {
        merkleProof: string[];
        data: {
          attestationType: string;
          sourceId: string;
          votingRound: number | BN | string;
          lowestUsedTimestamp: number | BN | string;
          requestBody: {
            minimalBlockNumber: number | BN | string;
            deadlineBlockNumber: number | BN | string;
            deadlineTimestamp: number | BN | string;
            destinationAddressHash: string;
            amount: number | BN | string;
            standardPaymentReference: string;
            checkSourceAddresses: boolean;
            sourceAddressesRoot: string;
          };
          responseBody: {
            minimalBlockTimestamp: number | BN | string;
            firstOverflowBlockNumber: number | BN | string;
            firstOverflowBlockTimestamp: number | BN | string;
          };
        };
      },
      _collateralReservationId: number | BN | string,
      txDetails?: Truffle.TransactionDetails
    ): Promise<void>;
    sendTransaction(
      _proof: {
        merkleProof: string[];
        data: {
          attestationType: string;
          sourceId: string;
          votingRound: number | BN | string;
          lowestUsedTimestamp: number | BN | string;
          requestBody: {
            minimalBlockNumber: number | BN | string;
            deadlineBlockNumber: number | BN | string;
            deadlineTimestamp: number | BN | string;
            destinationAddressHash: string;
            amount: number | BN | string;
            standardPaymentReference: string;
            checkSourceAddresses: boolean;
            sourceAddressesRoot: string;
          };
          responseBody: {
            minimalBlockTimestamp: number | BN | string;
            firstOverflowBlockNumber: number | BN | string;
            firstOverflowBlockTimestamp: number | BN | string;
          };
        };
      },
      _collateralReservationId: number | BN | string,
      txDetails?: Truffle.TransactionDetails
    ): Promise<string>;
    estimateGas(
      _proof: {
        merkleProof: string[];
        data: {
          attestationType: string;
          sourceId: string;
          votingRound: number | BN | string;
          lowestUsedTimestamp: number | BN | string;
          requestBody: {
            minimalBlockNumber: number | BN | string;
            deadlineBlockNumber: number | BN | string;
            deadlineTimestamp: number | BN | string;
            destinationAddressHash: string;
            amount: number | BN | string;
            standardPaymentReference: string;
            checkSourceAddresses: boolean;
            sourceAddressesRoot: string;
          };
          responseBody: {
            minimalBlockTimestamp: number | BN | string;
            firstOverflowBlockNumber: number | BN | string;
            firstOverflowBlockTimestamp: number | BN | string;
          };
        };
      },
      _collateralReservationId: number | BN | string,
      txDetails?: Truffle.TransactionDetails
    ): Promise<number>;
  };

  rejectCollateralReservation: {
    (
      _collateralReservationId: number | BN | string,
      txDetails?: Truffle.TransactionDetails
    ): Promise<Truffle.TransactionResponse<AllEvents>>;
    call(
      _collateralReservationId: number | BN | string,
      txDetails?: Truffle.TransactionDetails
    ): Promise<void>;
    sendTransaction(
      _collateralReservationId: number | BN | string,
      txDetails?: Truffle.TransactionDetails
    ): Promise<string>;
    estimateGas(
      _collateralReservationId: number | BN | string,
      txDetails?: Truffle.TransactionDetails
    ): Promise<number>;
  };

  reserveCollateral: {
    (
      _agentVault: string,
      _lots: number | BN | string,
      _maxMintingFeeBIPS: number | BN | string,
      _executor: string,
      _minterUnderlyingAddresses: string[],
      txDetails?: Truffle.TransactionDetails
    ): Promise<Truffle.TransactionResponse<AllEvents>>;
    call(
      _agentVault: string,
      _lots: number | BN | string,
      _maxMintingFeeBIPS: number | BN | string,
      _executor: string,
      _minterUnderlyingAddresses: string[],
      txDetails?: Truffle.TransactionDetails
    ): Promise<void>;
    sendTransaction(
      _agentVault: string,
      _lots: number | BN | string,
      _maxMintingFeeBIPS: number | BN | string,
      _executor: string,
      _minterUnderlyingAddresses: string[],
      txDetails?: Truffle.TransactionDetails
    ): Promise<string>;
    estimateGas(
      _agentVault: string,
      _lots: number | BN | string,
      _maxMintingFeeBIPS: number | BN | string,
      _executor: string,
      _minterUnderlyingAddresses: string[],
      txDetails?: Truffle.TransactionDetails
    ): Promise<number>;
  };

  unstickMinting: {
    (
      _proof: {
        merkleProof: string[];
        data: {
          attestationType: string;
          sourceId: string;
          votingRound: number | BN | string;
          lowestUsedTimestamp: number | BN | string;
          requestBody: {
            blockNumber: number | BN | string;
            queryWindow: number | BN | string;
          };
          responseBody: {
            blockTimestamp: number | BN | string;
            numberOfConfirmations: number | BN | string;
            lowestQueryWindowBlockNumber: number | BN | string;
            lowestQueryWindowBlockTimestamp: number | BN | string;
          };
        };
      },
      _collateralReservationId: number | BN | string,
      txDetails?: Truffle.TransactionDetails
    ): Promise<Truffle.TransactionResponse<AllEvents>>;
    call(
      _proof: {
        merkleProof: string[];
        data: {
          attestationType: string;
          sourceId: string;
          votingRound: number | BN | string;
          lowestUsedTimestamp: number | BN | string;
          requestBody: {
            blockNumber: number | BN | string;
            queryWindow: number | BN | string;
          };
          responseBody: {
            blockTimestamp: number | BN | string;
            numberOfConfirmations: number | BN | string;
            lowestQueryWindowBlockNumber: number | BN | string;
            lowestQueryWindowBlockTimestamp: number | BN | string;
          };
        };
      },
      _collateralReservationId: number | BN | string,
      txDetails?: Truffle.TransactionDetails
    ): Promise<void>;
    sendTransaction(
      _proof: {
        merkleProof: string[];
        data: {
          attestationType: string;
          sourceId: string;
          votingRound: number | BN | string;
          lowestUsedTimestamp: number | BN | string;
          requestBody: {
            blockNumber: number | BN | string;
            queryWindow: number | BN | string;
          };
          responseBody: {
            blockTimestamp: number | BN | string;
            numberOfConfirmations: number | BN | string;
            lowestQueryWindowBlockNumber: number | BN | string;
            lowestQueryWindowBlockTimestamp: number | BN | string;
          };
        };
      },
      _collateralReservationId: number | BN | string,
      txDetails?: Truffle.TransactionDetails
    ): Promise<string>;
    estimateGas(
      _proof: {
        merkleProof: string[];
        data: {
          attestationType: string;
          sourceId: string;
          votingRound: number | BN | string;
          lowestUsedTimestamp: number | BN | string;
          requestBody: {
            blockNumber: number | BN | string;
            queryWindow: number | BN | string;
          };
          responseBody: {
            blockTimestamp: number | BN | string;
            numberOfConfirmations: number | BN | string;
            lowestQueryWindowBlockNumber: number | BN | string;
            lowestQueryWindowBlockTimestamp: number | BN | string;
          };
        };
      },
      _collateralReservationId: number | BN | string,
      txDetails?: Truffle.TransactionDetails
    ): Promise<number>;
  };

  methods: {
    approveCollateralReservation: {
      (
        _collateralReservationId: number | BN | string,
        txDetails?: Truffle.TransactionDetails
      ): Promise<Truffle.TransactionResponse<AllEvents>>;
      call(
        _collateralReservationId: number | BN | string,
        txDetails?: Truffle.TransactionDetails
      ): Promise<void>;
      sendTransaction(
        _collateralReservationId: number | BN | string,
        txDetails?: Truffle.TransactionDetails
      ): Promise<string>;
      estimateGas(
        _collateralReservationId: number | BN | string,
        txDetails?: Truffle.TransactionDetails
      ): Promise<number>;
    };

    cancelCollateralReservation: {
      (
        _collateralReservationId: number | BN | string,
        txDetails?: Truffle.TransactionDetails
      ): Promise<Truffle.TransactionResponse<AllEvents>>;
      call(
        _collateralReservationId: number | BN | string,
        txDetails?: Truffle.TransactionDetails
      ): Promise<void>;
      sendTransaction(
        _collateralReservationId: number | BN | string,
        txDetails?: Truffle.TransactionDetails
      ): Promise<string>;
      estimateGas(
        _collateralReservationId: number | BN | string,
        txDetails?: Truffle.TransactionDetails
      ): Promise<number>;
    };

    collateralReservationFee(
      _lots: number | BN | string,
      txDetails?: Truffle.TransactionDetails
    ): Promise<BN>;

    mintingPaymentDefault: {
      (
        _proof: {
          merkleProof: string[];
          data: {
            attestationType: string;
            sourceId: string;
            votingRound: number | BN | string;
            lowestUsedTimestamp: number | BN | string;
            requestBody: {
              minimalBlockNumber: number | BN | string;
              deadlineBlockNumber: number | BN | string;
              deadlineTimestamp: number | BN | string;
              destinationAddressHash: string;
              amount: number | BN | string;
              standardPaymentReference: string;
              checkSourceAddresses: boolean;
              sourceAddressesRoot: string;
            };
            responseBody: {
              minimalBlockTimestamp: number | BN | string;
              firstOverflowBlockNumber: number | BN | string;
              firstOverflowBlockTimestamp: number | BN | string;
            };
          };
        },
        _collateralReservationId: number | BN | string,
        txDetails?: Truffle.TransactionDetails
      ): Promise<Truffle.TransactionResponse<AllEvents>>;
      call(
        _proof: {
          merkleProof: string[];
          data: {
            attestationType: string;
            sourceId: string;
            votingRound: number | BN | string;
            lowestUsedTimestamp: number | BN | string;
            requestBody: {
              minimalBlockNumber: number | BN | string;
              deadlineBlockNumber: number | BN | string;
              deadlineTimestamp: number | BN | string;
              destinationAddressHash: string;
              amount: number | BN | string;
              standardPaymentReference: string;
              checkSourceAddresses: boolean;
              sourceAddressesRoot: string;
            };
            responseBody: {
              minimalBlockTimestamp: number | BN | string;
              firstOverflowBlockNumber: number | BN | string;
              firstOverflowBlockTimestamp: number | BN | string;
            };
          };
        },
        _collateralReservationId: number | BN | string,
        txDetails?: Truffle.TransactionDetails
      ): Promise<void>;
      sendTransaction(
        _proof: {
          merkleProof: string[];
          data: {
            attestationType: string;
            sourceId: string;
            votingRound: number | BN | string;
            lowestUsedTimestamp: number | BN | string;
            requestBody: {
              minimalBlockNumber: number | BN | string;
              deadlineBlockNumber: number | BN | string;
              deadlineTimestamp: number | BN | string;
              destinationAddressHash: string;
              amount: number | BN | string;
              standardPaymentReference: string;
              checkSourceAddresses: boolean;
              sourceAddressesRoot: string;
            };
            responseBody: {
              minimalBlockTimestamp: number | BN | string;
              firstOverflowBlockNumber: number | BN | string;
              firstOverflowBlockTimestamp: number | BN | string;
            };
          };
        },
        _collateralReservationId: number | BN | string,
        txDetails?: Truffle.TransactionDetails
      ): Promise<string>;
      estimateGas(
        _proof: {
          merkleProof: string[];
          data: {
            attestationType: string;
            sourceId: string;
            votingRound: number | BN | string;
            lowestUsedTimestamp: number | BN | string;
            requestBody: {
              minimalBlockNumber: number | BN | string;
              deadlineBlockNumber: number | BN | string;
              deadlineTimestamp: number | BN | string;
              destinationAddressHash: string;
              amount: number | BN | string;
              standardPaymentReference: string;
              checkSourceAddresses: boolean;
              sourceAddressesRoot: string;
            };
            responseBody: {
              minimalBlockTimestamp: number | BN | string;
              firstOverflowBlockNumber: number | BN | string;
              firstOverflowBlockTimestamp: number | BN | string;
            };
          };
        },
        _collateralReservationId: number | BN | string,
        txDetails?: Truffle.TransactionDetails
      ): Promise<number>;
    };

    rejectCollateralReservation: {
      (
        _collateralReservationId: number | BN | string,
        txDetails?: Truffle.TransactionDetails
      ): Promise<Truffle.TransactionResponse<AllEvents>>;
      call(
        _collateralReservationId: number | BN | string,
        txDetails?: Truffle.TransactionDetails
      ): Promise<void>;
      sendTransaction(
        _collateralReservationId: number | BN | string,
        txDetails?: Truffle.TransactionDetails
      ): Promise<string>;
      estimateGas(
        _collateralReservationId: number | BN | string,
        txDetails?: Truffle.TransactionDetails
      ): Promise<number>;
    };

    reserveCollateral: {
      (
        _agentVault: string,
        _lots: number | BN | string,
        _maxMintingFeeBIPS: number | BN | string,
        _executor: string,
        _minterUnderlyingAddresses: string[],
        txDetails?: Truffle.TransactionDetails
      ): Promise<Truffle.TransactionResponse<AllEvents>>;
      call(
        _agentVault: string,
        _lots: number | BN | string,
        _maxMintingFeeBIPS: number | BN | string,
        _executor: string,
        _minterUnderlyingAddresses: string[],
        txDetails?: Truffle.TransactionDetails
      ): Promise<void>;
      sendTransaction(
        _agentVault: string,
        _lots: number | BN | string,
        _maxMintingFeeBIPS: number | BN | string,
        _executor: string,
        _minterUnderlyingAddresses: string[],
        txDetails?: Truffle.TransactionDetails
      ): Promise<string>;
      estimateGas(
        _agentVault: string,
        _lots: number | BN | string,
        _maxMintingFeeBIPS: number | BN | string,
        _executor: string,
        _minterUnderlyingAddresses: string[],
        txDetails?: Truffle.TransactionDetails
      ): Promise<number>;
    };

    unstickMinting: {
      (
        _proof: {
          merkleProof: string[];
          data: {
            attestationType: string;
            sourceId: string;
            votingRound: number | BN | string;
            lowestUsedTimestamp: number | BN | string;
            requestBody: {
              blockNumber: number | BN | string;
              queryWindow: number | BN | string;
            };
            responseBody: {
              blockTimestamp: number | BN | string;
              numberOfConfirmations: number | BN | string;
              lowestQueryWindowBlockNumber: number | BN | string;
              lowestQueryWindowBlockTimestamp: number | BN | string;
            };
          };
        },
        _collateralReservationId: number | BN | string,
        txDetails?: Truffle.TransactionDetails
      ): Promise<Truffle.TransactionResponse<AllEvents>>;
      call(
        _proof: {
          merkleProof: string[];
          data: {
            attestationType: string;
            sourceId: string;
            votingRound: number | BN | string;
            lowestUsedTimestamp: number | BN | string;
            requestBody: {
              blockNumber: number | BN | string;
              queryWindow: number | BN | string;
            };
            responseBody: {
              blockTimestamp: number | BN | string;
              numberOfConfirmations: number | BN | string;
              lowestQueryWindowBlockNumber: number | BN | string;
              lowestQueryWindowBlockTimestamp: number | BN | string;
            };
          };
        },
        _collateralReservationId: number | BN | string,
        txDetails?: Truffle.TransactionDetails
      ): Promise<void>;
      sendTransaction(
        _proof: {
          merkleProof: string[];
          data: {
            attestationType: string;
            sourceId: string;
            votingRound: number | BN | string;
            lowestUsedTimestamp: number | BN | string;
            requestBody: {
              blockNumber: number | BN | string;
              queryWindow: number | BN | string;
            };
            responseBody: {
              blockTimestamp: number | BN | string;
              numberOfConfirmations: number | BN | string;
              lowestQueryWindowBlockNumber: number | BN | string;
              lowestQueryWindowBlockTimestamp: number | BN | string;
            };
          };
        },
        _collateralReservationId: number | BN | string,
        txDetails?: Truffle.TransactionDetails
      ): Promise<string>;
      estimateGas(
        _proof: {
          merkleProof: string[];
          data: {
            attestationType: string;
            sourceId: string;
            votingRound: number | BN | string;
            lowestUsedTimestamp: number | BN | string;
            requestBody: {
              blockNumber: number | BN | string;
              queryWindow: number | BN | string;
            };
            responseBody: {
              blockTimestamp: number | BN | string;
              numberOfConfirmations: number | BN | string;
              lowestQueryWindowBlockNumber: number | BN | string;
              lowestQueryWindowBlockTimestamp: number | BN | string;
            };
          };
        },
        _collateralReservationId: number | BN | string,
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
