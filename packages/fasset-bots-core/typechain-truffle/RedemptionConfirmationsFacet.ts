/* Autogenerated file. Do not edit manually. */
/* tslint:disable */
/* eslint-disable */

import type { Truffle } from "./types";

import BN from "bn.js";
import { EventData, PastEventOptions } from "web3-eth-contract";

export interface RedemptionConfirmationsFacetContract
  extends Truffle.Contract<RedemptionConfirmationsFacetInstance> {
  "new"(
    meta?: Truffle.TransactionDetails
  ): Promise<RedemptionConfirmationsFacetInstance>;
}

export interface FullLiquidationStarted {
  name: "FullLiquidationStarted";
  args: {
    agentVault: string;
    timestamp: BN;
    0: string;
    1: BN;
  };
}

export interface LiquidationEnded {
  name: "LiquidationEnded";
  args: {
    agentVault: string;
    0: string;
  };
}

export interface RedemptionDefault {
  name: "RedemptionDefault";
  args: {
    agentVault: string;
    redeemer: string;
    requestId: BN;
    redemptionAmountUBA: BN;
    redeemedVaultCollateralWei: BN;
    redeemedPoolCollateralWei: BN;
    0: string;
    1: string;
    2: BN;
    3: BN;
    4: BN;
    5: BN;
  };
}

export interface RedemptionPaymentBlocked {
  name: "RedemptionPaymentBlocked";
  args: {
    agentVault: string;
    redeemer: string;
    requestId: BN;
    transactionHash: string;
    redemptionAmountUBA: BN;
    spentUnderlyingUBA: BN;
    0: string;
    1: string;
    2: BN;
    3: string;
    4: BN;
    5: BN;
  };
}

export interface RedemptionPaymentFailed {
  name: "RedemptionPaymentFailed";
  args: {
    agentVault: string;
    redeemer: string;
    requestId: BN;
    transactionHash: string;
    spentUnderlyingUBA: BN;
    failureReason: string;
    0: string;
    1: string;
    2: BN;
    3: string;
    4: BN;
    5: string;
  };
}

export interface RedemptionPerformed {
  name: "RedemptionPerformed";
  args: {
    agentVault: string;
    redeemer: string;
    requestId: BN;
    transactionHash: string;
    redemptionAmountUBA: BN;
    spentUnderlyingUBA: BN;
    0: string;
    1: string;
    2: BN;
    3: string;
    4: BN;
    5: BN;
  };
}

export interface UnderlyingBalanceChanged {
  name: "UnderlyingBalanceChanged";
  args: {
    agentVault: string;
    underlyingBalanceUBA: BN;
    0: string;
    1: BN;
  };
}

export interface UnderlyingBalanceTooLow {
  name: "UnderlyingBalanceTooLow";
  args: {
    agentVault: string;
    balance: BN;
    requiredBalance: BN;
    0: string;
    1: BN;
    2: BN;
  };
}

export type AllEvents =
  | FullLiquidationStarted
  | LiquidationEnded
  | RedemptionDefault
  | RedemptionPaymentBlocked
  | RedemptionPaymentFailed
  | RedemptionPerformed
  | UnderlyingBalanceChanged
  | UnderlyingBalanceTooLow;

export interface RedemptionConfirmationsFacetInstance
  extends Truffle.ContractInstance {
  confirmRedemptionPayment: {
    (
      _payment: {
        merkleProof: string[];
        data: {
          attestationType: string;
          sourceId: string;
          votingRound: number | BN | string;
          lowestUsedTimestamp: number | BN | string;
          requestBody: {
            transactionId: string;
            inUtxo: number | BN | string;
            utxo: number | BN | string;
          };
          responseBody: {
            blockNumber: number | BN | string;
            blockTimestamp: number | BN | string;
            sourceAddressHash: string;
            receivingAddressHash: string;
            intendedReceivingAddressHash: string;
            spentAmount: number | BN | string;
            intendedSpentAmount: number | BN | string;
            receivedAmount: number | BN | string;
            intendedReceivedAmount: number | BN | string;
            standardPaymentReference: string;
            oneToOne: boolean;
            status: number | BN | string;
          };
        };
      },
      _redemptionRequestId: number | BN | string,
      txDetails?: Truffle.TransactionDetails
    ): Promise<Truffle.TransactionResponse<AllEvents>>;
    call(
      _payment: {
        merkleProof: string[];
        data: {
          attestationType: string;
          sourceId: string;
          votingRound: number | BN | string;
          lowestUsedTimestamp: number | BN | string;
          requestBody: {
            transactionId: string;
            inUtxo: number | BN | string;
            utxo: number | BN | string;
          };
          responseBody: {
            blockNumber: number | BN | string;
            blockTimestamp: number | BN | string;
            sourceAddressHash: string;
            receivingAddressHash: string;
            intendedReceivingAddressHash: string;
            spentAmount: number | BN | string;
            intendedSpentAmount: number | BN | string;
            receivedAmount: number | BN | string;
            intendedReceivedAmount: number | BN | string;
            standardPaymentReference: string;
            oneToOne: boolean;
            status: number | BN | string;
          };
        };
      },
      _redemptionRequestId: number | BN | string,
      txDetails?: Truffle.TransactionDetails
    ): Promise<void>;
    sendTransaction(
      _payment: {
        merkleProof: string[];
        data: {
          attestationType: string;
          sourceId: string;
          votingRound: number | BN | string;
          lowestUsedTimestamp: number | BN | string;
          requestBody: {
            transactionId: string;
            inUtxo: number | BN | string;
            utxo: number | BN | string;
          };
          responseBody: {
            blockNumber: number | BN | string;
            blockTimestamp: number | BN | string;
            sourceAddressHash: string;
            receivingAddressHash: string;
            intendedReceivingAddressHash: string;
            spentAmount: number | BN | string;
            intendedSpentAmount: number | BN | string;
            receivedAmount: number | BN | string;
            intendedReceivedAmount: number | BN | string;
            standardPaymentReference: string;
            oneToOne: boolean;
            status: number | BN | string;
          };
        };
      },
      _redemptionRequestId: number | BN | string,
      txDetails?: Truffle.TransactionDetails
    ): Promise<string>;
    estimateGas(
      _payment: {
        merkleProof: string[];
        data: {
          attestationType: string;
          sourceId: string;
          votingRound: number | BN | string;
          lowestUsedTimestamp: number | BN | string;
          requestBody: {
            transactionId: string;
            inUtxo: number | BN | string;
            utxo: number | BN | string;
          };
          responseBody: {
            blockNumber: number | BN | string;
            blockTimestamp: number | BN | string;
            sourceAddressHash: string;
            receivingAddressHash: string;
            intendedReceivingAddressHash: string;
            spentAmount: number | BN | string;
            intendedSpentAmount: number | BN | string;
            receivedAmount: number | BN | string;
            intendedReceivedAmount: number | BN | string;
            standardPaymentReference: string;
            oneToOne: boolean;
            status: number | BN | string;
          };
        };
      },
      _redemptionRequestId: number | BN | string,
      txDetails?: Truffle.TransactionDetails
    ): Promise<number>;
  };

  methods: {
    confirmRedemptionPayment: {
      (
        _payment: {
          merkleProof: string[];
          data: {
            attestationType: string;
            sourceId: string;
            votingRound: number | BN | string;
            lowestUsedTimestamp: number | BN | string;
            requestBody: {
              transactionId: string;
              inUtxo: number | BN | string;
              utxo: number | BN | string;
            };
            responseBody: {
              blockNumber: number | BN | string;
              blockTimestamp: number | BN | string;
              sourceAddressHash: string;
              receivingAddressHash: string;
              intendedReceivingAddressHash: string;
              spentAmount: number | BN | string;
              intendedSpentAmount: number | BN | string;
              receivedAmount: number | BN | string;
              intendedReceivedAmount: number | BN | string;
              standardPaymentReference: string;
              oneToOne: boolean;
              status: number | BN | string;
            };
          };
        },
        _redemptionRequestId: number | BN | string,
        txDetails?: Truffle.TransactionDetails
      ): Promise<Truffle.TransactionResponse<AllEvents>>;
      call(
        _payment: {
          merkleProof: string[];
          data: {
            attestationType: string;
            sourceId: string;
            votingRound: number | BN | string;
            lowestUsedTimestamp: number | BN | string;
            requestBody: {
              transactionId: string;
              inUtxo: number | BN | string;
              utxo: number | BN | string;
            };
            responseBody: {
              blockNumber: number | BN | string;
              blockTimestamp: number | BN | string;
              sourceAddressHash: string;
              receivingAddressHash: string;
              intendedReceivingAddressHash: string;
              spentAmount: number | BN | string;
              intendedSpentAmount: number | BN | string;
              receivedAmount: number | BN | string;
              intendedReceivedAmount: number | BN | string;
              standardPaymentReference: string;
              oneToOne: boolean;
              status: number | BN | string;
            };
          };
        },
        _redemptionRequestId: number | BN | string,
        txDetails?: Truffle.TransactionDetails
      ): Promise<void>;
      sendTransaction(
        _payment: {
          merkleProof: string[];
          data: {
            attestationType: string;
            sourceId: string;
            votingRound: number | BN | string;
            lowestUsedTimestamp: number | BN | string;
            requestBody: {
              transactionId: string;
              inUtxo: number | BN | string;
              utxo: number | BN | string;
            };
            responseBody: {
              blockNumber: number | BN | string;
              blockTimestamp: number | BN | string;
              sourceAddressHash: string;
              receivingAddressHash: string;
              intendedReceivingAddressHash: string;
              spentAmount: number | BN | string;
              intendedSpentAmount: number | BN | string;
              receivedAmount: number | BN | string;
              intendedReceivedAmount: number | BN | string;
              standardPaymentReference: string;
              oneToOne: boolean;
              status: number | BN | string;
            };
          };
        },
        _redemptionRequestId: number | BN | string,
        txDetails?: Truffle.TransactionDetails
      ): Promise<string>;
      estimateGas(
        _payment: {
          merkleProof: string[];
          data: {
            attestationType: string;
            sourceId: string;
            votingRound: number | BN | string;
            lowestUsedTimestamp: number | BN | string;
            requestBody: {
              transactionId: string;
              inUtxo: number | BN | string;
              utxo: number | BN | string;
            };
            responseBody: {
              blockNumber: number | BN | string;
              blockTimestamp: number | BN | string;
              sourceAddressHash: string;
              receivingAddressHash: string;
              intendedReceivingAddressHash: string;
              spentAmount: number | BN | string;
              intendedSpentAmount: number | BN | string;
              receivedAmount: number | BN | string;
              intendedReceivedAmount: number | BN | string;
              standardPaymentReference: string;
              oneToOne: boolean;
              status: number | BN | string;
            };
          };
        },
        _redemptionRequestId: number | BN | string,
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
