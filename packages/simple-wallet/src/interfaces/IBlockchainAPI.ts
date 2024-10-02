import { AxiosInstance, AxiosResponse } from "axios";
import { ChainType } from "../utils/constants";

export interface IBlockchainAPI {
    client: AxiosInstance;

    getAccountBalance(account: string): Promise<number | undefined>;

    sendTransaction(tx: string): Promise<AxiosResponse>;

    getUTXOsFromMempool(address: string, chainType: ChainType): Promise<MempoolUTXO[]>;

    getUTXOsWithoutScriptFromMempool(address: string, chainType: ChainType): Promise<MempoolUTXOMWithoutScript[]>;

    getUTXOScript(txHash: string, vout: number, chainType: ChainType): Promise<string>;

    getCurrentFeeRate(): Promise<number>;

    getCurrentBlockHeight(): Promise<number>;

    getTransaction(txHash: string): Promise<any>;
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