import {AxiosResponse} from "axios";

export interface IBlockchainAPI {

    getAccountBalance(account: string): Promise<number | undefined>;

    sendTransaction(tx: string): Promise<AxiosResponse>;

    getUTXOsFromMempool(address: string): Promise<MempoolUTXO[]>;

    getCurrentFeeRate(nextBlocks: number): Promise<number>;

    getCurrentBlockHeight(): Promise<number>;

    getTransaction(txHash: string | undefined): Promise<AxiosResponse>;
}

export interface MempoolUTXO {
    mintTxid: number,
    mintIndex: number,
    value: number,
    script: string,
}