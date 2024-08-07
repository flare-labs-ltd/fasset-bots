import {IBlockchainAPI, MempoolUTXO} from "../interfaces/IBlockchainAPI";
import axios, {AxiosInstance, AxiosRequestConfig} from "axios";
import {DEFAULT_RATE_LIMIT_OPTIONS} from "../utils/constants";
import axiosRateLimit from "../axios-rate-limiter/axios-rate-limit";
import {RateLimitOptions} from "../interfaces/IWalletTransaction";

export class BitcoreAPI implements IBlockchainAPI {
    private client: AxiosInstance;

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

    async getCurrentBlockHeight(): Promise<number> {
        const res = await this.client.get(`/`);
        return res.data.blockbook.bestHeight;
    }

    async getCurrentFeeRate(nextBlocks: number): Promise<number> {
        const res = await this.client.get(`/fee/${nextBlocks}`);
        return res.data.feerate;
    }

    async getTransaction(txHash: string | undefined): Promise<axios.AxiosResponse> {
        return this.client.get(`/tx/${txHash}`);
    }

    async getUTXOsFromMempool(address: string): Promise<MempoolUTXO[]> {
        const res = await this.client.get(`/address/${address}?unspent=true&limit=0&excludeconflicting=true`);
        // https://github.com/bitpay/bitcore/blob/405f8b17dbb537277bea89ca131214793e577151/packages/bitcore-node/src/types/Coin.ts#L26
        // utxo.mintHeight > -3 => excludeConflicting; utxo.spentHeight == -2 -> unspent
        return (res.data as any[]).filter((utxo) => utxo.mintHeight > -3 && utxo.spentHeight == -2).sort((a, b) => a.value - b.value);
    }

    private async getUnspentOutputScriptFromBlockbook(txHash: string, vout: number) {
        const res = await this.client.get(`/tx-specific/${txHash}`);
        return res.data.vout[vout].scriptPubKey.hex;
    }

    async sendTransaction(tx: string): Promise<axios.AxiosResponse> {
        return this.client.post(`/tx/send`, {rawTx: tx});
    }

}