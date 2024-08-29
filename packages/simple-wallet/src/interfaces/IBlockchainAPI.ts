import { AxiosInstance, AxiosResponse } from "axios";

export interface IBlockchainAPI {
    client: AxiosInstance;

    getAccountBalance(account: string): Promise<number | undefined>;

    sendTransaction(tx: string): Promise<AxiosResponse>;

    getUTXOsFromMempool(address: string): Promise<MempoolUTXO[]>;

    getUTXOsWithoutScriptFromMempool(address: string): Promise<MempoolUTXOMWithoutScript[]>;

    getUTXOScript(address: string, txHash: string, vout: number): Promise<string>;

    getCurrentFeeRate(nextBlocks: number): Promise<number>;

    getCurrentBlockHeight(): Promise<BlockData>;

    getTransaction(txHash: string | undefined): Promise<AxiosResponse>;
}

export interface MempoolUTXOMWithoutScript {
    mintTxid: string,
    mintIndex: number,
    value: number,
    confirmed: boolean,
}

export interface MempoolUTXO extends MempoolUTXOMWithoutScript {
    script: string,
}

export interface BlockData{
    number: number,
    timestamp: number
}