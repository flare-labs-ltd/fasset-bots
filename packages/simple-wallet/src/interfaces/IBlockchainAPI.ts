import { AxiosInstance, AxiosResponse } from "axios";
import { ChainType } from "../utils/constants";
import BN from "bn.js";

export interface IBlockchainAPI {

    getAccountBalance(account: string): Promise<number | undefined>;

    sendTransaction(tx: string): Promise<AxiosResponse>;

    getUTXOsFromMempool(address: string, chainType: ChainType): Promise<MempoolUTXO[]>;

    getUTXOScript(txHash: string, vout: number, chainType: ChainType): Promise<string>;

    getCurrentFeeRate(blockNumber?: number): Promise<number>;

    getBlockTimeAt(blockNumber: number): Promise<BN>;

    getCurrentBlockHeight(): Promise<number>;

    getTransaction(txHash: string): Promise<UTXOTransactionResponse>;
}

export interface MempoolUTXO {
    mintTxid: string,
    mintIndex: number,
    value: BN,
    confirmed: boolean,
    script: string,
}
export interface UTXOResponse {
    txid: string;
    vout: number;
    value: string;
    confirmations: number;
}

export interface UTXOAddressResponse {
    address: string;
    vout: number;
    balance: string;
    unconfirmedBalance: string;
}

export interface UTXOBlockHeightResponse {
    blockbook: {
        bestHeight: number;
    }
}

export interface FeeStatsResponse {
    averageFeePerKb: number;
    decilesFeePerKb: number[];
}

export interface UTXOBlockResponse {
    height: number;
    confirmations: number;
    time: number;
    hash: string;
}

export interface UTXOTransactionResponse {
    txid: string;
    version: number
    vin: UTXOVinResponse[];
    vout: UTXOVoutResponse[];
    blockHash: string;
    blockHeight: number;
    confirmations: number;
    blockTime: number;
    size: number;
    vsize: number;
    value: string;
    valueIn: string;
    fees: string;
    hex: string;
}

export interface UTXOVinResponse {
    txid: string;
    sequence: number;
    vout: number;
    value: string;
    addresses: string[];
}
export interface UTXOVoutResponse {
    value: string;
    n: number;
    hex: string;
    addresses: string[];
    spent: boolean;
}

export interface UTXORawTransaction {
    hash: string;
    version: number;
    inputs: UTXORawTransactionInput[];
    outputs: UTXORawTransactionOutput[];
    nLockTime: number;
    changeScript: string;
    changeIndex: number;
}

export interface UTXORawTransactionInput {
    prevTxId: string;
    outputIndex: number;
    sequenceNumber: number;
    script: string;
    scriptString: string;
    output: UTXORawTransactionOutput;
}

export interface UTXORawTransactionOutput {
    script: string;
    satoshis: number;
}

export interface AxiosTransactionSubmissionError {
    error: string;
}