/* Autogenerated file. Do not edit manually. */
/* tslint:disable */
/* eslint-disable */

import type { Truffle } from "./types";

import BN from "bn.js";
import { EventData, PastEventOptions } from "web3-eth-contract";

export interface SCProofVerifierContract
  extends Truffle.Contract<SCProofVerifierInstance> {
  "new"(
    _merkleRootStorage: string,
    meta?: Truffle.TransactionDetails
  ): Promise<SCProofVerifierInstance>;
}

export type AllEvents = never;

export interface SCProofVerifierInstance extends Truffle.ContractInstance {
  merkleRootStorage(txDetails?: Truffle.TransactionDetails): Promise<string>;

  verifyAddressValidity(
    _proof: {
      merkleProof: string[];
      data: {
        attestationType: string;
        sourceId: string;
        votingRound: number | BN | string;
        lowestUsedTimestamp: number | BN | string;
        requestBody: { addressStr: string };
        responseBody: {
          isValid: boolean;
          standardAddress: string;
          standardAddressHash: string;
        };
      };
    },
    txDetails?: Truffle.TransactionDetails
  ): Promise<boolean>;

  verifyBalanceDecreasingTransaction(
    _proof: {
      merkleProof: string[];
      data: {
        attestationType: string;
        sourceId: string;
        votingRound: number | BN | string;
        lowestUsedTimestamp: number | BN | string;
        requestBody: { transactionId: string; sourceAddressIndicator: string };
        responseBody: {
          blockNumber: number | BN | string;
          blockTimestamp: number | BN | string;
          sourceAddressHash: string;
          spentAmount: number | BN | string;
          standardPaymentReference: string;
        };
      };
    },
    txDetails?: Truffle.TransactionDetails
  ): Promise<boolean>;

  verifyConfirmedBlockHeightExists(
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
    txDetails?: Truffle.TransactionDetails
  ): Promise<boolean>;

  verifyPayment(
    _proof: {
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
    txDetails?: Truffle.TransactionDetails
  ): Promise<boolean>;

  verifyReferencedPaymentNonexistence(
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
        };
        responseBody: {
          minimalBlockTimestamp: number | BN | string;
          firstOverflowBlockNumber: number | BN | string;
          firstOverflowBlockTimestamp: number | BN | string;
        };
      };
    },
    txDetails?: Truffle.TransactionDetails
  ): Promise<boolean>;

  methods: {
    merkleRootStorage(txDetails?: Truffle.TransactionDetails): Promise<string>;

    verifyAddressValidity(
      _proof: {
        merkleProof: string[];
        data: {
          attestationType: string;
          sourceId: string;
          votingRound: number | BN | string;
          lowestUsedTimestamp: number | BN | string;
          requestBody: { addressStr: string };
          responseBody: {
            isValid: boolean;
            standardAddress: string;
            standardAddressHash: string;
          };
        };
      },
      txDetails?: Truffle.TransactionDetails
    ): Promise<boolean>;

    verifyBalanceDecreasingTransaction(
      _proof: {
        merkleProof: string[];
        data: {
          attestationType: string;
          sourceId: string;
          votingRound: number | BN | string;
          lowestUsedTimestamp: number | BN | string;
          requestBody: {
            transactionId: string;
            sourceAddressIndicator: string;
          };
          responseBody: {
            blockNumber: number | BN | string;
            blockTimestamp: number | BN | string;
            sourceAddressHash: string;
            spentAmount: number | BN | string;
            standardPaymentReference: string;
          };
        };
      },
      txDetails?: Truffle.TransactionDetails
    ): Promise<boolean>;

    verifyConfirmedBlockHeightExists(
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
      txDetails?: Truffle.TransactionDetails
    ): Promise<boolean>;

    verifyPayment(
      _proof: {
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
      txDetails?: Truffle.TransactionDetails
    ): Promise<boolean>;

    verifyReferencedPaymentNonexistence(
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
          };
          responseBody: {
            minimalBlockTimestamp: number | BN | string;
            firstOverflowBlockNumber: number | BN | string;
            firstOverflowBlockTimestamp: number | BN | string;
          };
        };
      },
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
