import {
    EstimateFeeResponse,
    FeeStatsResponse,
    IBlockchainAPI,
    MempoolUTXO,
    UTXOAddressResponse, UTXOBlockHeightResponse, UTXOBlockResponse, UTXORawTransactionInput, UTXOResponse,
    UTXOTransactionResponse,
} from "../interfaces/IBlockchainAPI";
import { AxiosInstance, AxiosResponse } from "axios";
import { WalletServiceConfigBase } from "../interfaces/IWalletTransaction";
import { ChainType, DOGE_DEFAULT_FEE_PER_KB, SATS_PER_BTC_DOGE } from "../utils/constants";
import BN from "bn.js";
import { toBN } from "../utils/bnutils";
import { getConfirmedAfter } from "../chain-clients/utxo/UTXOUtils";
import { createAxiosInstance, tryWithClients } from "../utils/axios-utils";
import { stuckTransactionConstants } from "../utils/utils";
import { logger } from "../utils/logger";


export class UTXOBlockchainAPI implements IBlockchainAPI {
    clients: AxiosInstance[] = [];
    chainType: ChainType;
    requestCount = 0;

    constructor(createConfig: WalletServiceConfigBase, chainType: ChainType) {
        for (const [index, url] of createConfig.urls.entries()) {
            this.clients.push(createAxiosInstance(url, createConfig.apiTokenKeys?.[index], createConfig.rateLimitOptions));
        }
        this.chainType = chainType;
    }

    async logRequest<T>(description: string, promise: Promise<T>): Promise<T> {
        let failed = false;
        const start = Date.now();
        try {
            return await promise;
        } catch (error) {
            failed = true;
            throw error;
        } finally {
            const elapsed = Date.now() - start;
            logger.info(`Blockbook request ${++this.requestCount} took ${elapsed}ms ${failed ? " (ERROR)" : ""}: ${description}`);
        }
    }

    async getAccountBalance(account: string): Promise<BN> {
        return await this.logRequest(`getAccountBalance(${account})`, tryWithClients(this.clients, async (client: AxiosInstance) => {
            const res = await client.get<UTXOAddressResponse>(`/address/${account}`);
            const totalBalance = res.data.balance;
            const unconfirmedBalance = res.data.unconfirmedBalance;

            const totBalance = toBN(totalBalance);
            const uncBalance = toBN(unconfirmedBalance);
            return totBalance.add(uncBalance);
        }, "getAccountBalance"));
    }

    lastGetCurrentBlockHeightTs = 0;
    lastGetCurrentBlockHeightResult = 0;

    async getCurrentBlockHeight(): Promise<number> {
        if (Date.now() - this.lastGetCurrentBlockHeightTs < 1000) {
            return this.lastGetCurrentBlockHeightResult;
        }
        this.lastGetCurrentBlockHeightResult = await this.logRequest(`getCurrentBlockHeight()`, tryWithClients(this.clients, async (client: AxiosInstance) => {
            const res = await client.get<UTXOBlockHeightResponse>(``);
            return res.data.blockbook.bestHeight;
        }, "getCurrentBlockHeight"));
        this.lastGetCurrentBlockHeightTs = Date.now();
        return this.lastGetCurrentBlockHeightResult;
    }

    async getCurrentFeeRate(blockNumber?: number): Promise<number> { // in sats per kb
        const blockToCheck = blockNumber ?? await this.getCurrentBlockHeight();
        return await this.logRequest(`getCurrentFeeRate(${blockNumber})`, tryWithClients(this.clients, async (client: AxiosInstance) => {
            const res = await client.get<FeeStatsResponse>(`/feestats/${blockToCheck}`);
            const fee = res.data.averageFeePerKb;
            return fee;
        }, "getCurrentFeeRate"));
    }

    async getEstimateFee(inTheNextBlocks: number = 2): Promise<number> { // in sats per kb
        return await this.logRequest(`getEstimateFee(${inTheNextBlocks})`, tryWithClients(this.clients, async (client: AxiosInstance) => {
            const res = await client.get<EstimateFeeResponse>(`/estimatefee/${inTheNextBlocks}`);
            if (res.data.error) {
                logger.error(`RPC Error: ${res.data.error.message} (Code: ${res.data.error.code})`);
                return DOGE_DEFAULT_FEE_PER_KB.toNumber();
            }
            const fee = Number(res.data.result);
            if (isNaN(fee)) {
                logger.error(`Invalid fee estimate received: ${res.data.result}`);
                return DOGE_DEFAULT_FEE_PER_KB.toNumber();
            }
            return Math.round(fee * SATS_PER_BTC_DOGE);
        }, "getEstimateFee"));
    }

    async getBlockTimeAt(blockNumber: number): Promise<BN> {
        return await this.logRequest(`getBlockTimeAt(${blockNumber})`, tryWithClients(this.clients, async (client: AxiosInstance) => {
            const res = await client.get<UTXOBlockResponse>(`/block/${blockNumber}`);
            return toBN(res.data.time ?? 0);
        }, "getBlockTimeAt"));
    }

    async getTransaction(txHash: string, logWithStackTrace?: boolean): Promise<UTXOTransactionResponse> {
        return await this.logRequest(`getTransaction(${txHash})`, tryWithClients(this.clients, async (client: AxiosInstance) => {
            const res = await client.get<UTXOTransactionResponse>(`/tx/${txHash}`);
            return res.data;
        }, "getTransaction", logWithStackTrace ?? true));
    }

    async getUTXOScript(txHash: string, vout: number): Promise<string> {
        return await this.logRequest(`getUTXOScript(${txHash}, ${vout})`, tryWithClients(this.clients, async (client: AxiosInstance) => {
            const res = await client.get<UTXOTransactionResponse>(`/tx/${txHash}`);
            /* istanbul ignore next: ignore for the ?? */
            return res.data.vout[vout]?.hex ?? "";
        }, "getUTXOScript"));
    }

    async getUTXOsFromMempool(address: string): Promise<MempoolUTXO[]> {
        return await this.logRequest(`getUTXOsFromMempool(${address})`, tryWithClients(this.clients, async (client: AxiosInstance) => {
            const res = await client.get<UTXOResponse[]>(`/utxo/${address}`);
            return res.data.map((utxo: UTXOResponse): MempoolUTXO => ({
                transactionHash: utxo.txid,
                position: utxo.vout,
                value: toBN(utxo.value),
                script: "",
                confirmed: utxo.confirmations >= (stuckTransactionConstants(this.chainType).enoughConfirmations ?? /* istanbul ignore next */ getConfirmedAfter(this.chainType)),
            }));
        }, "getUTXOsFromMempool"));
    }

    async sendTransaction(tx: string): Promise<AxiosResponse> {
        return await this.logRequest(`sendTransaction(...)`, tryWithClients(this.clients, async (client: AxiosInstance) => {
            return await client.post('/sendtx/', tx, {
                headers: { 'Content-Type': 'text/plain' }
            });
        }, "sendTransaction"));
    }

    async findTransactionHashWithInputs(address: string, inputs: UTXORawTransactionInput[], submittedInBlock: number): Promise<string> {
        return await this.logRequest(`findTransactionHashWithInputs(${address}, #${inputs?.length}, ${submittedInBlock})`, tryWithClients(this.clients, async (client: AxiosInstance) => {
            const params = new URLSearchParams({
                from: String(submittedInBlock - this.getNumberOfBlocksForSearch()),
                to: String(submittedInBlock + this.getNumberOfBlocksForSearch()),
            });

            const firstResp = await client.get<UTXOAddressResponse>(`/address/${address}?${params.toString()}`);
            const totalPages = firstResp.data.totalPages ?? 0;
            for (let i = 0; i < totalPages; i++) {
                params.set("page", String(i + 1));
                const resp = await client.get<UTXOAddressResponse>(`/address/${address}?${params.toString()}`);
                const inputSet = new Set(inputs.map(input => `${input.prevTxId}:${input.outputIndex}`));

                for (const txHash of resp.data.txids ?? []) {
                    const txResp = await this.getTransaction(txHash);
                    const mappedInputSet = new Set(txResp.vin.map(t => `${t.txid}:${t.vout}`));

                    if (Array.from(inputSet).every(input => mappedInputSet.has(input))) {
                        return txResp.txid;
                    }
                }
            }

            return "";
        }, "findTransactionHashWithInputs"));
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
