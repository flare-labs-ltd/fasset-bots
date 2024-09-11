import { BlockData, IBlockchainAPI, MempoolUTXO, MempoolUTXOMWithoutScript } from "../interfaces/IBlockchainAPI";
import axios, { AxiosInstance, AxiosRequestConfig, AxiosResponse } from "axios";
import { ChainType, DEFAULT_RATE_LIMIT_OPTIONS } from "../utils/constants";
import axiosRateLimit from "../axios-rate-limiter/axios-rate-limit";
import { RateLimitOptions } from "../interfaces/IWalletTransaction";
import { getConfirmedAfter, getDateTimestampInSeconds } from "../utils/utils";

export class BitcoreAPI implements IBlockchainAPI {
    client: AxiosInstance;

    constructor(axiosConfig: AxiosRequestConfig, rateLimitOptions: RateLimitOptions | undefined) {
        const client = axios.create(axiosConfig);
        this.client = axiosRateLimit(client, {
            ...DEFAULT_RATE_LIMIT_OPTIONS,
            ...rateLimitOptions,
        });
    }

    async getAccountBalance(account: string): Promise<number | undefined> {
        const res = await this.client.get(`/address/${account}/balance`);
        return res.data?.confirmed;
    }

    async getCurrentBlockHeight(): Promise<BlockData> {
        const res = await this.client.get(`/block/tip`);
        const blockNumber = res.data.height;
        const blockTimestamp = getDateTimestampInSeconds(res.data.time);
        return {
            number: blockNumber,
            timestamp: blockTimestamp
        };
    }

    async getCurrentFeeRate(nextBlocks: number): Promise<number> {
        const res = await this.client.get(`/fee/${nextBlocks}`);
        return res.data.feerate;
    }

    async getTransaction(txHash: string | undefined): Promise<AxiosResponse> {
        return this.client.get(`/tx/${txHash}`);
    }

    async getUTXOsFromMempool(address: string, chainType: ChainType): Promise<MempoolUTXO[]> {
        const res = await this.client.get(`/address/${address}?unspent=true&limit=0&excludeconflicting=true`);
        // https://github.com/bitpay/bitcore/blob/405f8b17dbb537277bea89ca131214793e577151/packages/bitcore-node/src/types/Coin.ts#L26
        // utxo.mintHeight > -3 => excludeConflicting; utxo.spentHeight == -2 -> unspent
        return (res.data as any[])
            .filter((utxo) => utxo.mintHeight > -3 && utxo.spentHeight == -2)
            .sort((a, b) => a.value - b.value)
            .map(utxo => ({
                mintTxid: utxo.mintTxid,
                mintIndex: utxo.mintIndex,
                value: utxo.value,
                confirmed: utxo.mintHeight >= getConfirmedAfter(chainType),
                script: utxo.script,
            }));
    }

    async getUTXOScript(address: string, txHash: string, vout: number, chainType: ChainType): Promise<string> {
        const mempoolUTXOS = await this.getUTXOsFromMempool(address, chainType);
        return mempoolUTXOS.filter(utxo => utxo.mintIndex.valueOf() === vout && utxo.mintTxid === txHash)[0].script;
    }

    async getUTXOsWithoutScriptFromMempool(address: string, chainType: ChainType): Promise<MempoolUTXOMWithoutScript[]> {
        return this.getUTXOsFromMempool(address, chainType);
    }

    async sendTransaction(tx: string): Promise<AxiosResponse> {
        return this.client.post(`/tx/send`, { rawTx: tx });
    }

}