import { IBlockchainAPI, MempoolUTXO, MempoolUTXOMWithoutScript } from "../interfaces/IBlockchainAPI";
import axios, { AxiosInstance, AxiosRequestConfig } from "axios";
import { DEFAULT_RATE_LIMIT_OPTIONS } from "../utils/constants";
import axiosRateLimit from "../axios-rate-limiter/axios-rate-limit";
import { RateLimitOptions } from "../interfaces/IWalletTransaction";
import { fetchTransactionEntityByHash } from "../db/dbutils";
import { EntityManager } from "@mikro-orm/core";
import { TransactionOutputEntity } from "../entity/transactionOutput";

export class BlockbookAPI implements IBlockchainAPI {
    client: AxiosInstance;
    rootEm: EntityManager;

    constructor(axiosConfig: AxiosRequestConfig, rateLimitOptions: RateLimitOptions | undefined, rootEm: EntityManager) {
        const client = axios.create(axiosConfig);
        this.client = axiosRateLimit(client, {
            ...DEFAULT_RATE_LIMIT_OPTIONS,
            ...rateLimitOptions,
        });
        this.rootEm = rootEm;
    }

    async getAccountBalance(account: string): Promise<number | undefined> {
        const res = await this.client.get(`/address/${account}`);
        return res.data?.balance;
    }

    async getCurrentBlockHeight(): Promise<number> {
        const res = await this.client.get(``);
        return res.data.blockbook.bestHeight;
    }

    async getCurrentFeeRate(nextBlocks: number): Promise<number> {
        const res = await this.client.get(`/estimatefee/${nextBlocks}`);
        return res.data.result;
    }

    async getTransaction(txHash: string | undefined): Promise<axios.AxiosResponse<any>> {
        return await this.client.get(`/tx/${txHash}`);
    }

    async getUTXOsFromMempool(address: string): Promise<MempoolUTXO[]> {
        const res = await this.client.get(`/utxo/${address}`);
        return Promise.all(res.data.map(async (utxo: any) => {
            const txOutputEnt = await this.rootEm.findOne(TransactionOutputEntity, {
                vout: utxo.vout,
                transactionHash: utxo.txid,
            });

            return {
                mintTxid: utxo.txid,
                mintIndex: utxo.vout,
                value: utxo.value,
                script: txOutputEnt?.script ?? "",
                confirmed: utxo.confirmations > 0,
            };
        }));
    }

    async getUTXOsWithoutScriptFromMempool(address: string): Promise<MempoolUTXOMWithoutScript[]> {
        const res = await this.client.get(`/utxo/${address}`);
        return res.data.map((utxo: any) => ({
            mintTxid: utxo.txid,
            mintIndex: utxo.vout,
            value: utxo.value,
        }));
    }

    async getUTXOScript(address: string, txHash: string, vout: number) {
        const res = await this.client.get(`/tx-specific/${txHash}`);
        return res.data.vout[vout].scriptPubKey.hex;
    }

    async sendTransaction(tx: string): Promise<axios.AxiosResponse> {
        return await this.client.get(`/sendtx/${tx}`);
    }

}