import {IBlockchainAPI, MempoolUTXO} from "../interfaces/IBlockchainAPI";
import axios, {AxiosInstance, AxiosRequestConfig} from "axios";
import {DEFAULT_RATE_LIMIT_OPTIONS} from "../utils/constants";
import axiosRateLimit from "../axios-rate-limiter/axios-rate-limit";
import {RateLimitOptions} from "../interfaces/IWalletTransaction";
import {fetchTransactionEntityByHash} from "../db/dbutils";
import {EntityManager} from "@mikro-orm/core";

export class BlockbookAPI implements IBlockchainAPI {
    private client: AxiosInstance;
    private rootEm: EntityManager;

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
        const res = await this.client.get(`/utxo/${address}?confirmed=true`);
        const utxos = [];

        for (const utxo of res.data) {
            let script;
            try {
                const txEnt = await fetchTransactionEntityByHash(this.rootEm, utxo.txid);
                script = txEnt.outputs.getItems().find(output => output.vout === utxo.vout)?.script;
            } catch (e) {
                script = await this.getUnspentOutputScriptFromBlockbook(utxo.txid, utxo.vout);
            }
            utxos.push({
                mintTxid: utxo.txid,
                mintIndex: utxo.vout,
                value: utxo.value,
                script: script,
            });
        }

        return utxos;
    }

    private async getUnspentOutputScriptFromBlockbook(txHash: string, vout: number) {
        const res = await this.client.get(`/tx-specific/${txHash}`);
        return res.data.vout[vout].scriptPubKey.hex;
    }

    async sendTransaction(tx: string): Promise<axios.AxiosResponse> {
        return await this.client.get(`/sendtx/${tx}`);
    }

}