import { IBlockchainAPI, MempoolUTXO, MempoolUTXOMWithoutScript } from "../interfaces/IBlockchainAPI";
import axios, { AxiosInstance, AxiosRequestConfig, AxiosResponse } from "axios";
import { ChainType, DEFAULT_RATE_LIMIT_OPTIONS } from "../utils/constants";
import axiosRateLimit from "../axios-rate-limiter/axios-rate-limit";
import { RateLimitOptions } from "../interfaces/IWalletTransaction";
import { EntityManager } from "@mikro-orm/core";
import { toBN, toNumber } from "../utils/bnutils";
import { getConfirmedAfter } from "../chain-clients/utxo/UTXOUtils";

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
        const totalBalance = res.data?.balance;
        const unconfirmedBalance = res.data?.unconfirmedBalance;
        /* istanbul ignore else */
        if (!!totalBalance && !!unconfirmedBalance) {
            const totBalance = toBN(totalBalance);
            const uncBalance = toBN(unconfirmedBalance);
            return toNumber(totBalance.add(uncBalance));
        }
        /*istanbul ignore next */
        return undefined;
    }

    async getCurrentBlockHeight(): Promise<number> {
        const res = await this.client.get(``);
        return res.data.blockbook.bestHeight;
    }

    async getCurrentFeeRate(): Promise<number> {
        const blockNumber: number = await this.getCurrentBlockHeight();
        const res = await this.client.get(`/feestats/${blockNumber}`);
        const BTC_PER_SATOSHI = 1 / 100000000;
        const fee = res.data.averageFeePerKb * BTC_PER_SATOSHI
        return fee;
    }

    async getTransaction(txHash: string): Promise<AxiosResponse<any>> {
        return await this.client.get(`/tx/${txHash}`);
    }

    async getUTXOsFromMempool(address: string, chainType: ChainType): Promise<MempoolUTXO[]> {
        const res = await this.client.get(`/utxo/${address}`);
        return Promise.all(res.data.map((utxo: any) => {
            return {
                mintTxid: utxo.txid,
                mintIndex: utxo.vout,
                value: utxo.value,
                script: "",
                confirmed: utxo.confirmations >= getConfirmedAfter(chainType),
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

    async getUTXOScript(txHash: string, vout: number) {
        const res = await this.client.get(`/tx-specific/${txHash}`);
        return res.data.vout[vout]?.scriptPubKey?.hex ?? "";
    }

    async sendTransaction(tx: string): Promise<AxiosResponse> {
        return await this.client.get(`/sendtx/${tx}`);
    }
}