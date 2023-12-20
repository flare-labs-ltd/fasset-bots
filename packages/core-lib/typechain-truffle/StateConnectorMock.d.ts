/* Autogenerated file. Do not edit manually. */
/* tslint:disable */
/* eslint-disable */

import BN from "bn.js";
import { EventData, PastEventOptions } from "web3-eth-contract";

export interface StateConnectorMockContract
  extends Truffle.Contract<StateConnectorMockInstance> {
  "new"(meta?: Truffle.TransactionDetails): Promise<StateConnectorMockInstance>;
}

export interface AttestationRequest {
  name: "AttestationRequest";
  args: {
    sender: string;
    timestamp: BN;
    data: string;
    0: string;
    1: BN;
    2: string;
  };
}

export interface RoundFinalised {
  name: "RoundFinalised";
  args: {
    roundId: BN;
    merkleRoot: string;
    0: BN;
    1: string;
  };
}

type AllEvents = AttestationRequest | RoundFinalised;

export interface StateConnectorMockInstance extends Truffle.ContractInstance {
  BUFFER_TIMESTAMP_OFFSET(txDetails?: Truffle.TransactionDetails): Promise<BN>;

  BUFFER_WINDOW(txDetails?: Truffle.TransactionDetails): Promise<BN>;

  TOTAL_STORED_PROOFS(txDetails?: Truffle.TransactionDetails): Promise<BN>;

  lastFinalizedRoundId(txDetails?: Truffle.TransactionDetails): Promise<BN>;

  merkleRoot(
    _roundId: number | BN | string,
    txDetails?: Truffle.TransactionDetails
  ): Promise<string>;

  merkleRoots(
    arg0: number | BN | string,
    txDetails?: Truffle.TransactionDetails
  ): Promise<string>;

  requestAttestations: {
    (_data: string, txDetails?: Truffle.TransactionDetails): Promise<
      Truffle.TransactionResponse<AllEvents>
    >;
    call(_data: string, txDetails?: Truffle.TransactionDetails): Promise<void>;
    sendTransaction(
      _data: string,
      txDetails?: Truffle.TransactionDetails
    ): Promise<string>;
    estimateGas(
      _data: string,
      txDetails?: Truffle.TransactionDetails
    ): Promise<number>;
  };

  setMerkleRoot: {
    (
      _stateConnectorRound: number | BN | string,
      _merkleRoot: string,
      txDetails?: Truffle.TransactionDetails
    ): Promise<Truffle.TransactionResponse<AllEvents>>;
    call(
      _stateConnectorRound: number | BN | string,
      _merkleRoot: string,
      txDetails?: Truffle.TransactionDetails
    ): Promise<void>;
    sendTransaction(
      _stateConnectorRound: number | BN | string,
      _merkleRoot: string,
      txDetails?: Truffle.TransactionDetails
    ): Promise<string>;
    estimateGas(
      _stateConnectorRound: number | BN | string,
      _merkleRoot: string,
      txDetails?: Truffle.TransactionDetails
    ): Promise<number>;
  };

  methods: {
    BUFFER_TIMESTAMP_OFFSET(
      txDetails?: Truffle.TransactionDetails
    ): Promise<BN>;

    BUFFER_WINDOW(txDetails?: Truffle.TransactionDetails): Promise<BN>;

    TOTAL_STORED_PROOFS(txDetails?: Truffle.TransactionDetails): Promise<BN>;

    lastFinalizedRoundId(txDetails?: Truffle.TransactionDetails): Promise<BN>;

    merkleRoot(
      _roundId: number | BN | string,
      txDetails?: Truffle.TransactionDetails
    ): Promise<string>;

    merkleRoots(
      arg0: number | BN | string,
      txDetails?: Truffle.TransactionDetails
    ): Promise<string>;

    requestAttestations: {
      (_data: string, txDetails?: Truffle.TransactionDetails): Promise<
        Truffle.TransactionResponse<AllEvents>
      >;
      call(
        _data: string,
        txDetails?: Truffle.TransactionDetails
      ): Promise<void>;
      sendTransaction(
        _data: string,
        txDetails?: Truffle.TransactionDetails
      ): Promise<string>;
      estimateGas(
        _data: string,
        txDetails?: Truffle.TransactionDetails
      ): Promise<number>;
    };

    setMerkleRoot: {
      (
        _stateConnectorRound: number | BN | string,
        _merkleRoot: string,
        txDetails?: Truffle.TransactionDetails
      ): Promise<Truffle.TransactionResponse<AllEvents>>;
      call(
        _stateConnectorRound: number | BN | string,
        _merkleRoot: string,
        txDetails?: Truffle.TransactionDetails
      ): Promise<void>;
      sendTransaction(
        _stateConnectorRound: number | BN | string,
        _merkleRoot: string,
        txDetails?: Truffle.TransactionDetails
      ): Promise<string>;
      estimateGas(
        _stateConnectorRound: number | BN | string,
        _merkleRoot: string,
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