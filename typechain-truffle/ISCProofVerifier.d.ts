/* Autogenerated file. Do not edit manually. */
/* tslint:disable */
/* eslint-disable */

import BN from "bn.js";
import { EventData, PastEventOptions } from "web3-eth-contract";

export interface ISCProofVerifierContract
  extends Truffle.Contract<ISCProofVerifierInstance> {
  "new"(meta?: Truffle.TransactionDetails): Promise<ISCProofVerifierInstance>;
}

type AllEvents = never;

export interface ISCProofVerifierInstance extends Truffle.ContractInstance {
  verifyBalanceDecreasingTransaction(
    _chainId: number | BN | string,
    _data: {
      merkleProof: string[];
      stateConnectorRound: number | BN | string;
      blockNumber: number | BN | string;
      blockTimestamp: number | BN | string;
      transactionHash: string;
      sourceAddressIndicator: string;
      sourceAddressHash: string;
      spentAmount: number | BN | string;
      paymentReference: string;
    },
    txDetails?: Truffle.TransactionDetails
  ): Promise<boolean>;

  verifyConfirmedBlockHeightExists(
    _chainId: number | BN | string,
    _data: {
      merkleProof: string[];
      stateConnectorRound: number | BN | string;
      blockNumber: number | BN | string;
      blockTimestamp: number | BN | string;
      numberOfConfirmations: number | BN | string;
      lowestQueryWindowBlockNumber: number | BN | string;
      lowestQueryWindowBlockTimestamp: number | BN | string;
    },
    txDetails?: Truffle.TransactionDetails
  ): Promise<boolean>;

  verifyPayment(
    _chainId: number | BN | string,
    _data: {
      merkleProof: string[];
      stateConnectorRound: number | BN | string;
      blockNumber: number | BN | string;
      blockTimestamp: number | BN | string;
      transactionHash: string;
      inUtxo: number | BN | string;
      utxo: number | BN | string;
      sourceAddressHash: string;
      intendedSourceAddressHash: string;
      receivingAddressHash: string;
      intendedReceivingAddressHash: string;
      spentAmount: number | BN | string;
      intendedSpentAmount: number | BN | string;
      receivedAmount: number | BN | string;
      intendedReceivedAmount: number | BN | string;
      paymentReference: string;
      oneToOne: boolean;
      status: number | BN | string;
    },
    txDetails?: Truffle.TransactionDetails
  ): Promise<boolean>;

  verifyReferencedPaymentNonexistence(
    _chainId: number | BN | string,
    _data: {
      merkleProof: string[];
      stateConnectorRound: number | BN | string;
      deadlineBlockNumber: number | BN | string;
      deadlineTimestamp: number | BN | string;
      destinationAddressHash: string;
      paymentReference: string;
      amount: number | BN | string;
      lowerBoundaryBlockNumber: number | BN | string;
      lowerBoundaryBlockTimestamp: number | BN | string;
      firstOverflowBlockNumber: number | BN | string;
      firstOverflowBlockTimestamp: number | BN | string;
    },
    txDetails?: Truffle.TransactionDetails
  ): Promise<boolean>;

  methods: {
    verifyBalanceDecreasingTransaction(
      _chainId: number | BN | string,
      _data: {
        merkleProof: string[];
        stateConnectorRound: number | BN | string;
        blockNumber: number | BN | string;
        blockTimestamp: number | BN | string;
        transactionHash: string;
        sourceAddressIndicator: string;
        sourceAddressHash: string;
        spentAmount: number | BN | string;
        paymentReference: string;
      },
      txDetails?: Truffle.TransactionDetails
    ): Promise<boolean>;

    verifyConfirmedBlockHeightExists(
      _chainId: number | BN | string,
      _data: {
        merkleProof: string[];
        stateConnectorRound: number | BN | string;
        blockNumber: number | BN | string;
        blockTimestamp: number | BN | string;
        numberOfConfirmations: number | BN | string;
        lowestQueryWindowBlockNumber: number | BN | string;
        lowestQueryWindowBlockTimestamp: number | BN | string;
      },
      txDetails?: Truffle.TransactionDetails
    ): Promise<boolean>;

    verifyPayment(
      _chainId: number | BN | string,
      _data: {
        merkleProof: string[];
        stateConnectorRound: number | BN | string;
        blockNumber: number | BN | string;
        blockTimestamp: number | BN | string;
        transactionHash: string;
        inUtxo: number | BN | string;
        utxo: number | BN | string;
        sourceAddressHash: string;
        intendedSourceAddressHash: string;
        receivingAddressHash: string;
        intendedReceivingAddressHash: string;
        spentAmount: number | BN | string;
        intendedSpentAmount: number | BN | string;
        receivedAmount: number | BN | string;
        intendedReceivedAmount: number | BN | string;
        paymentReference: string;
        oneToOne: boolean;
        status: number | BN | string;
      },
      txDetails?: Truffle.TransactionDetails
    ): Promise<boolean>;

    verifyReferencedPaymentNonexistence(
      _chainId: number | BN | string,
      _data: {
        merkleProof: string[];
        stateConnectorRound: number | BN | string;
        deadlineBlockNumber: number | BN | string;
        deadlineTimestamp: number | BN | string;
        destinationAddressHash: string;
        paymentReference: string;
        amount: number | BN | string;
        lowerBoundaryBlockNumber: number | BN | string;
        lowerBoundaryBlockTimestamp: number | BN | string;
        firstOverflowBlockNumber: number | BN | string;
        firstOverflowBlockTimestamp: number | BN | string;
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
