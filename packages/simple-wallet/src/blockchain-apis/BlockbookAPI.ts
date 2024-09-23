import { BlockData, IBlockchainAPI, MempoolUTXO, MempoolUTXOMWithoutScript } from "../interfaces/IBlockchainAPI";
import axios, { AxiosInstance, AxiosRequestConfig, AxiosResponse } from "axios";
import { ChainType, DEFAULT_RATE_LIMIT_OPTIONS } from "../utils/constants";
import axiosRateLimit from "../axios-rate-limiter/axios-rate-limit";
import { RateLimitOptions } from "../interfaces/IWalletTransaction";
import { EntityManager } from "@mikro-orm/core";
import { getConfirmedAfter, getDateTimestampInSeconds } from "../utils/utils";
import { logger } from "../utils/logger";

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

    async getCurrentBlockHeight(): Promise<BlockData> {
        const res = await this.client.get(``);
        return {
            number: res.data.blockbook.bestHeight,
            timestamp: getDateTimestampInSeconds(res.data.blockbook.lastBlockTime)
        };
    }

    async getCurrentFeeRate(nextBlocks: number): Promise<number> {
        const block = await this.getCurrentBlockHeight();
        const res = await this.client.get(`/feestats/${block.number}`);
        const BTC_PER_SATOSHI = 1 / 100000000;
        const fee = res.data.averageFeePerKb * BTC_PER_SATOSHI
        return fee;
    }

    async getTransaction(txHash: string | undefined): Promise<AxiosResponse<any>> {
        return await this.client.get(`/tx/${txHash}`);
    }

    async getUTXOsFromMempool(address: string, chainType: ChainType): Promise<MempoolUTXO[]> {
        const res = await this.client.get(`/utxo/${address}`);
        return Promise.all(res.data.map(async (utxo: any) => {
            return {
                mintTxid: utxo.txid,
                mintIndex: utxo.vout,
                value: utxo.value,
                script: "",
                confirmed: utxo.confirmations > getConfirmedAfter(chainType),
            };
        }));
    }

    async getUTXOsWithoutScriptFromMempool(address: string, chainType: ChainType): Promise<MempoolUTXOMWithoutScript[]> {
        const res = await this.client.get(`/utxo/${address}`);
        return res.data.map((utxo: any) => ({
            mintTxid: utxo.txid,
            mintIndex: utxo.vout,
            value: utxo.value,
            confirmed: utxo.confirmations >= getConfirmedAfter(chainType),
        }));
    }

    async getUTXOScript(address: string, txHash: string, vout: number) {
        const res = await this.client.get(`/tx-specific/${txHash}`);
        return res.data.vout[vout]?.scriptPubKey?.hex ?? "";
    }

    async sendTransaction(tx: string): Promise<AxiosResponse> {
        return await this.client.get(`/sendtx/${tx}`);
    }

}