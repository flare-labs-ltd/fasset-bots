import { AxiosInstance, AxiosResponse } from "axios";

export interface IBlockchainAPI {
    client: AxiosInstance;

    getAccountBalance(account: string): Promise<number | undefined>;

    sendTransaction(tx: string): Promise<AxiosResponse>;

    getUTXOsFromMempool(address: string): Promise<MempoolUTXO[]>;

    getUTXOsWithoutScriptFromMempool(address: string): Promise<MempoolUTXOMWithoutScript[]>;

    getCurrentFeeRate(nextBlocks: number): Promise<number>;

    getCurrentBlockHeight(): Promise<number>;

    getTransaction(txHash: string | undefined): Promise<AxiosResponse>;
}

export interface MempoolUTXOMWithoutScript {
    mintTxid: number,
    mintIndex: number,
    value: number,
}

export interface MempoolUTXO extends MempoolUTXOMWithoutScript {
    script: string,
}

