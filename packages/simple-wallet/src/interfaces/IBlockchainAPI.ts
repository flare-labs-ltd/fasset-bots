import { AxiosResponse } from "axios";
import { ChainType } from "../utils/constants";
import BN from "bn.js";

export interface IBlockchainAPI {
    getAccountBalance(account: string): Promise<BN | undefined>;

    sendTransaction(tx: string): Promise<AxiosResponse>;

    getUTXOsFromMempool(address: string, chainType: ChainType): Promise<MempoolUTXO[]>;

    getUTXOScript(txHash: string, vout: number): Promise<string>;

    getCurrentFeeRate(blockNumber?: number): Promise<number>;

    getBlockTimeAt(blockNumber: number): Promise<BN>;

    getCurrentBlockHeight(): Promise<number>;

    getTransaction(txHash: string): Promise<UTXOTransactionResponse>;

    findTransactionHashWithInputs(address: string, inputs: UTXORawTransactionInput[], submittedInBlock: number): Promise<string>;
}

export interface MempoolUTXO {
    transactionHash: string,
    position: number,
    value: BN,
    confirmed: boolean,
    script: string,
}

//https://github.com/trezor/blockbook/blob/4a7fdb509569a31ada721801d1ff57ad88afa553/blockbook-api.ts
export interface UTXOResponse {
    txid: string;
    vout: number;
    value: string;
    confirmations: number;
}
//https://github.com/trezor/blockbook/blob/4a7fdb509569a31ada721801d1ff57ad88afa553/blockbook-api.ts
export interface UTXOAddressResponse {
    address: string;
    balance: string;
    unconfirmedBalance: string;
    unconfirmedTxs: string;
    txids?: string[];
    totalPages?: number;
    page?: number;
}
//https://github.com/trezor/blockbook/blob/4a7fdb509569a31ada721801d1ff57ad88afa553/blockbook-api.ts
export interface UTXOBlockHeightResponse {
    blockbook: {
        bestHeight: number;
    }
}
//https://github.com/trezor/blockbook/blob/4a7fdb509569a31ada721801d1ff57ad88afa553/blockbook-api.ts
export interface FeeStatsResponse {
    averageFeePerKb: number;
    decilesFeePerKb: number[];
}
//https://github.com/trezor/blockbook/blob/4a7fdb509569a31ada721801d1ff57ad88afa553/blockbook-api.ts
export interface UTXOBlockResponse {
    height: number;
    confirmations: number;
    time?: number;
    hash: string;
}
//https://github.com/trezor/blockbook/blob/4a7fdb509569a31ada721801d1ff57ad88afa553/blockbook-api.ts
export interface UTXOTransactionResponse {
    txid: string;
    version?: number
    vin: UTXOVinResponse[];
    vout: UTXOVoutResponse[];
    blockHash?: string;
    blockHeight: number;
    confirmations: number;
    blockTime: number;
    size?: number;
    vsize?: number;
    value: string;
    valueIn?: string;
    fees?: string;
    hex?: string;
}
//https://github.com/trezor/blockbook/blob/4a7fdb509569a31ada721801d1ff57ad88afa553/blockbook-api.ts
export interface UTXOVinResponse {
    txid?: string;
    sequence?: number;
    vout?: number;
    value?: string;
    addresses?: string[];
}
//https://github.com/trezor/blockbook/blob/4a7fdb509569a31ada721801d1ff57ad88afa553/blockbook-api.ts
export interface UTXOVoutResponse {
    value?: string;
    n: number;
    hex?: string;
    addresses: string[];
    spent?: boolean;
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