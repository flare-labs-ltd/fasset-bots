import axios from "axios";

export interface IBlockchainAPI {
    getAccountBalance(account: string): Promise<number | undefined>;

    sendTransaction(tx: string): Promise<axios.AxiosResponse>;

    getUTXOsFromMempool(address: string): Promise<MempoolUTXO[]>;

    getCurrentFeeRate(nextBlocks: number): Promise<number>;

    getCurrentBlockHeight(): Promise<number>;

    getTransaction(txHash: string | undefined): Promise<axios.AxiosResponse>;
}

export interface MempoolUTXO {
    mintTxid: number,
    mintIndex: number,
    value: number,
    script: string,
}