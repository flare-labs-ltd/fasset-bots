import {
    FeeStatsResponse,
    IBlockchainAPI,
    MempoolUTXO,
    UTXOAddressResponse, UTXOBlockHeightResponse, UTXOBlockResponse, UTXOResponse,
    UTXOTransactionResponse,
} from "../interfaces/IBlockchainAPI";
import { AxiosInstance, AxiosResponse } from "axios";
import { BaseWalletConfig } from "../interfaces/IWalletTransaction";
import { BTC_PER_SATOSHI, ChainType } from "../utils/constants";
import BN from "bn.js";
import { toBN, toNumber } from "../utils/bnutils";
import { getConfirmedAfter } from "../chain-clients/utxo/UTXOUtils";
import { createAxiosInstance, tryWithClients } from "../utils/axios-utils";
import { stuckTransactionConstants } from "../utils/utils";


export class UTXOBlockchainAPI implements IBlockchainAPI {
    clients: AxiosInstance[] = [];
    chainType: ChainType;

    constructor(createConfig: BaseWalletConfig, chainType: ChainType) {
        for (const [index, url] of createConfig.urls.entries()) {
            this.clients.push(createAxiosInstance(url, createConfig.apiTokenKeys?.[index], createConfig.rateLimitOptions));
        }
        this.chainType = chainType;
    }

    async getAccountBalance(account: string): Promise<number | undefined> {
        return tryWithClients(this.clients, async (client: AxiosInstance) => {
            const res = await client.get(`/address/${account}`);
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
        },"getCurrentBlockHeight");
    }

    async getCurrentBlockHeight(): Promise<number> {
        return tryWithClients(this.clients, async (client: AxiosInstance) => {
            const res = await client.get(``);
            const data: UTXOBlockHeightResponse = res.data as UTXOBlockHeightResponse;
            return data.blockbook.bestHeight;
        }, "getCurrentBlockHeight");
    }

    async getCurrentFeeRate(blockNumber?: number): Promise<number> {
        return tryWithClients(this.clients, async (client: AxiosInstance) => {
            const blockToCheck = blockNumber ?? await this.getCurrentBlockHeight();
            const res = await client.get(`/feestats/${blockToCheck}`);
            const data = res.data as FeeStatsResponse;
            const fee = data.averageFeePerKb * BTC_PER_SATOSHI;
            return fee;
        }, "getCurrentFeeRate");
    }

    async getBlockTimeAt(blockNumber: number): Promise<BN> {
        return tryWithClients(this.clients, async (client: AxiosInstance) => {
            const res = await client.get(`/block/${blockNumber}`);
            const data = res.data as UTXOBlockResponse;
            return toBN(data.time);
        }, "getBlockTimeAt");
    }

    async getTransaction(txHash: string): Promise<UTXOTransactionResponse> {
        return tryWithClients(this.clients, async (client: AxiosInstance) => {
            const res = await client.get(`/tx/${txHash}`);
            const data = res.data as UTXOTransactionResponse;
            return data;
        }, "getTransaction");
    }

    async getUTXOScript(txHash: string, vout: number): Promise<string> {
        return tryWithClients(this.clients, async (client: AxiosInstance) => {
            const res = await client.get(`/tx/${txHash}`);
            const data = res.data as UTXOTransactionResponse;
            /* istanbul ignore next: ignore for the ?? */
            return data.vout[vout]?.hex ?? "";
        },"getUTXOScript");
    }

    async getUTXOsFromMempool(address: string): Promise<MempoolUTXO[]> {
        return tryWithClients(this.clients, async (client: AxiosInstance) => {
            const res = await client.get(`/utxo/${address}`);
            const data = res.data as UTXOResponse[];

            return data.map((utxo: UTXOResponse): MempoolUTXO => ({
                mintTxid: utxo.txid,
                mintIndex: utxo.vout,
                value: toBN(utxo.value),
                script: "",
                confirmed: utxo.confirmations >= (stuckTransactionConstants(this.chainType).enoughConfirmations ?? /* istanbul ignore next */ getConfirmedAfter(this.chainType)),
            }));
        },"getUTXOsFromMempool");
    }

    async sendTransaction(tx: string): Promise<AxiosResponse> {
        return tryWithClients(this.clients, async (client: AxiosInstance) => {
            return await client.get(`/sendtx/${tx}`);
        }, "sendTransaction");
    }
}