import { UTXOBlockHeightResponse, FeeStatsResponse, IBlockchainAPI, MempoolUTXO, UTXOAddressResponse, UTXOResponse, UTXOBlockResponse, UTXOTransactionResponse } from "../interfaces/IBlockchainAPI";
import axios, { AxiosInstance, AxiosRequestConfig, AxiosResponse } from "axios";
import { BTC_PER_SATOSHI, ChainType, DEFAULT_RATE_LIMIT_OPTIONS } from "../utils/constants";
import axiosRateLimit from "../axios-rate-limiter/axios-rate-limit";
import { RateLimitOptions } from "../interfaces/IWalletTransaction";
import { EntityManager } from "@mikro-orm/core";
import { toBN, toNumber } from "../utils/bnutils";
import { getConfirmedAfter } from "../chain-clients/utxo/UTXOUtils";
import BN from "bn.js";
import { stuckTransactionConstants } from "../utils/utils";

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
        const data: UTXOAddressResponse = res.data as UTXOAddressResponse;
        const totalBalance = data.balance;
        const unconfirmedBalance = data.unconfirmedBalance;
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
        const data: UTXOBlockHeightResponse = res.data as UTXOBlockHeightResponse;
        return data.blockbook.bestHeight;
    }

    async getCurrentFeeRate(blockNumber?: number): Promise<number> {
        const blockToCheck = blockNumber ?? await this.getCurrentBlockHeight();
        const res = await this.client.get(`/feestats/${blockToCheck}`);
        const data = res.data as FeeStatsResponse;
        const fee = data.averageFeePerKb * BTC_PER_SATOSHI;
        return fee;
    }

    async getBlockTimeAt(blockNumber: number): Promise<BN> {
        const res = await this.client.get(`/block/${blockNumber}`);
        const data = res.data as UTXOBlockResponse;
        return toBN(data.time);
    }

    async getTransaction(txHash: string): Promise<UTXOTransactionResponse> {
        const res = await this.client.get(`/tx/${txHash}`);
        const data = res.data as UTXOTransactionResponse;
        return data;
    }

    async getUTXOsFromMempool(address: string, chainType: ChainType): Promise<MempoolUTXO[]> {
        const res = await this.client.get(`/utxo/${address}`);
        const data = res.data as UTXOResponse[];

        return data.map((utxo: UTXOResponse): MempoolUTXO => ({
            mintTxid: utxo.txid,
            mintIndex: utxo.vout,
            value: toBN(utxo.value),
            script: "",
            /* istanbul ignore next */
            confirmed: utxo.confirmations >= (stuckTransactionConstants(chainType).enoughConfirmations ?? getConfirmedAfter(chainType)),
        }));
    }

    async getUTXOScript(txHash: string, voutParam: number) {
        const res = await this.getTransaction(txHash)
        /* istanbul ignore next: ignore for the ?? */
        return res.vout[voutParam]?.hex ?? "";
    }

    async sendTransaction(tx: string): Promise<AxiosResponse> {
        return await this.client.get(`/sendtx/${tx}`);
    }
}
