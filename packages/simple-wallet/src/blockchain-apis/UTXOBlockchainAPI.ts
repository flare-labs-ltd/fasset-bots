import {
    AccountBalanceResponse,
    FeeStatsResponse,
    IBlockchainAPI,
    MempoolUTXO,
    UTXOAddressResponse, UTXOBlockHeightResponse, UTXOBlockResponse, UTXORawTransactionInput, UTXOResponse,
    UTXOTransactionResponse,
} from "../interfaces/IBlockchainAPI";
import { AxiosInstance, AxiosResponse } from "axios";
import { WalletServiceConfigBase } from "../interfaces/IWalletTransaction";
import { ChainType } from "../utils/constants";
import BN from "bn.js";
import { toBN, toNumber } from "../utils/bnutils";
import { getConfirmedAfter } from "../chain-clients/utxo/UTXOUtils";
import { createAxiosInstance, tryWithClients } from "../utils/axios-utils";
import { stuckTransactionConstants } from "../utils/utils";


export class UTXOBlockchainAPI implements IBlockchainAPI {
    clients: AxiosInstance[] = [];
    chainType: ChainType;

    constructor(createConfig: WalletServiceConfigBase, chainType: ChainType) {
        for (const [index, url] of createConfig.urls.entries()) {
            this.clients.push(createAxiosInstance(url, createConfig.apiTokenKeys?.[index], createConfig.rateLimitOptions));
        }
        this.chainType = chainType;
    }

    async getAccountBalance(account: string): Promise<AccountBalanceResponse> {
        return tryWithClients(this.clients, async (client: AxiosInstance) => {
            const res = await client.get<UTXOAddressResponse>(`/address/${account}`);
            const totalBalance = res.data.balance;
            const unconfirmedBalance = res.data.unconfirmedBalance;
            const unconfirmedTxs = res.data.unconfirmedTxs;

            const totBalance = toBN(totalBalance);
            const uncBalance = toBN(unconfirmedBalance);
            return {
                balance: toNumber(totBalance.add(uncBalance)),
                unconfirmedBalance: toNumber(uncBalance),
                unconfirmedTxs: toNumber(unconfirmedTxs),
            } as AccountBalanceResponse;
        }, "getAccountBalance");
    }

    async getCurrentBlockHeight(): Promise<number> {
        return tryWithClients(this.clients, async (client: AxiosInstance) => {
            const res = await client.get<UTXOBlockHeightResponse>(``);
            return res.data.blockbook.bestHeight;
        }, "getCurrentBlockHeight");
    }

    async getCurrentFeeRate(blockNumber?: number): Promise<number> { // in satoshies
        const blockToCheck = blockNumber ?? await this.getCurrentBlockHeight();
        return tryWithClients(this.clients, async (client: AxiosInstance) => {
            const res = await client.get<FeeStatsResponse>(`/feestats/${blockToCheck}`);
            const fee = res.data.averageFeePerKb;
            return fee;
        }, "getCurrentFeeRate");
    }

    async getBlockTimeAt(blockNumber: number): Promise<BN> {
        return tryWithClients(this.clients, async (client: AxiosInstance) => {
            const res = await client.get<UTXOBlockResponse>(`/block/${blockNumber}`);
            return toBN(res.data.time);
        }, "getBlockTimeAt");
    }

    async getTransaction(txHash: string): Promise<UTXOTransactionResponse> {
        return tryWithClients(this.clients, async (client: AxiosInstance) => {
            const res = await client.get<UTXOTransactionResponse>(`/tx/${txHash}`);
            return res.data;
        }, "getTransaction");
    }

    async getUTXOScript(txHash: string, vout: number): Promise<string> {
        return tryWithClients(this.clients, async (client: AxiosInstance) => {
            const res = await client.get<UTXOTransactionResponse>(`/tx/${txHash}`);
            /* istanbul ignore next: ignore for the ?? */
            return res.data.vout[vout]?.hex ?? "";
        }, "getUTXOScript");
    }

    async getUTXOsFromMempool(address: string): Promise<MempoolUTXO[]> {
        return tryWithClients(this.clients, async (client: AxiosInstance) => {
            const res = await client.get<UTXOResponse[]>(`/utxo/${address}`);
            return res.data.map((utxo: UTXOResponse): MempoolUTXO => ({
                mintTxid: utxo.txid,
                mintIndex: utxo.vout,
                value: toBN(utxo.value),
                script: "",
                confirmed: utxo.confirmations >= (stuckTransactionConstants(this.chainType).enoughConfirmations ?? /* istanbul ignore next */ getConfirmedAfter(this.chainType)),
            }));
        }, "getUTXOsFromMempool");
    }

    async sendTransaction(tx: string): Promise<AxiosResponse> {
        return tryWithClients(this.clients, async (client: AxiosInstance) => {
            return await client.post('/sendtx/', tx, {
                headers: { 'Content-Type': 'text/plain' }
            });
        }, "sendTransaction");
    }

    async findTransactionHashWithInputs(address: string, inputs: UTXORawTransactionInput[], submittedInBlock: number): Promise<string> {
        return tryWithClients(this.clients, async (client: AxiosInstance) => {
            const params = new URLSearchParams({
                from: String(submittedInBlock - this.getNumberOfBlocksForSearch()),
                to: String(submittedInBlock + this.getNumberOfBlocksForSearch()),
            });

            const firstResp = await client.get<UTXOAddressResponse>(`/address/${address}?${params.toString()}`);
            for (let i = 0; i < firstResp.data.totalPages; i++) {
                const resp = await client.get<UTXOAddressResponse>(`/address/${address}?${params.toString()}`);
                const inputSet = new Set(inputs.map(input => `${input.prevTxId}:${input.outputIndex}`));

                for (const txHash of resp.data.txids) {
                    const txResp = await this.getTransaction(txHash);
                    const mappedInputSet = new Set(txResp.vin.map(t => `${t.txid}:${t.vout}`));

                    if (Array.from(inputSet).every(input => mappedInputSet.has(input))) {
                        return txResp.txid;
                    }
                }
            }

            return "";
        }, "findTransactionHashWithInputs");
    }

    private getNumberOfBlocksForSearch(): number {
        switch (this.chainType) {
            case ChainType.BTC:
                return 5;
            case ChainType.testBTC:
                return 10;
            case ChainType.DOGE:
                return 10;
            case ChainType.testDOGE:
                return 15;
            default:
                return 15;
        }
    }
}
