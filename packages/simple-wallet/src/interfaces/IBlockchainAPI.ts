import { AxiosInstance, AxiosResponse } from "axios";
import { ChainType } from "../utils/constants";
import BN from "bn.js";

export interface IBlockchainAPI {
    client: AxiosInstance;

    getAccountBalance(account: string): Promise<number | undefined>;

    sendTransaction(tx: string): Promise<AxiosResponse>;

    getUTXOsFromMempool(address: string, chainType: ChainType): Promise<MempoolUTXO[]>;

    getUTXOScript(txHash: string, vout: number, chainType: ChainType): Promise<string>;

    getCurrentFeeRate(blockNumber?: number): Promise<number>;

    getBlockTimeAt(blockNumber: number): Promise<BN>;

    getCurrentBlockHeight(): Promise<number>;

    getTransaction(txHash: string): Promise<any>;
}

export interface MempoolUTXO {
    mintTxid: string,
    mintIndex: number,
    value: number,
    confirmed: boolean,
    script: string,
}