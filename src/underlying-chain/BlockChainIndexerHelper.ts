import { IBlock, IBlockChain, IBlockId, ITransaction, TxInputOutput } from "./interfaces/IBlockChain";
import axios, { AxiosInstance, AxiosRequestConfig } from "axios";
import { getSourceName, SourceId } from "../verification/sources/sources";
import { toBN } from "../utils/helpers";
import { WalletClient } from "simple-wallet";
import { BTC_MDU, hexToBase32 } from "@flarenetwork/mcc";

const DEFAULT_TIMEOUT = 15000;

export class BlockChainIndexerHelper implements IBlockChain {

    finalizationBlocks: number = 0;
    secondsPerBlock: number = 0;
    client: AxiosInstance;

    constructor(
        public indexerWebServerUrl: string,
        public sourceId: SourceId,
        public walletClient: WalletClient
    ) {
        const createAxiosConfig: AxiosRequestConfig = {
            baseURL: indexerWebServerUrl,
            timeout: DEFAULT_TIMEOUT,
            headers: { "Content-Type": "application/json" },
            validateStatus: function (status: number) {
                return (status >= 200 && status < 300) || status == 500;
            },
        };
        // set client
        this.client = axios.create(createAxiosConfig);
    }

    async getTransaction(txHash: string): Promise<ITransaction | null> {
        const chain = getSourceName(this.sourceId);
        const resp = await this.client.get(`/api/indexer/chain/${chain}/transaction/${txHash}`);
        const status = resp.data.status;
        const data = resp.data.data;
        if (status == "OK") {
            if (data) {
                return {
                    hash: data.transactionId,
                    inputs: this.handleInputs(data),
                    outputs: this.handleOutputs(data),
                    reference: data.paymentReference,
                    status: 0 //TODO
                };
            }
        }
        return null;
    }

    async getTransactionBlock(txHash: string): Promise<IBlockId | null> {
        const chain = getSourceName(this.sourceId);
        const resp = await this.client.get(`/api/indexer/chain/${chain}/transaction-block/${txHash}`);
        const status = resp.data.status;
        const data = resp.data.data;
        if (status == "OK") {
            if (data) {
                return {
                    hash: data.blockHash,
                    number: data.blockNumber
                }
            }
        }
        return null;
    }

    async getBalance(address: string): Promise<import("bn.js")> {
        const balance = await this.walletClient.getAccountBalance(address);
        return toBN(balance);
    }

    async getBlock(blockHash: string): Promise<IBlock | null> {
        const chain = getSourceName(this.sourceId);
        const resp = await this.client.get(`/api/indexer/chain/${chain}/block/${blockHash}`);
        const status = resp.data.status;
        const data = resp.data.data;
        if (status == "OK") {
            if (data) {
                return {
                    hash: data.blockHash,
                    number: data.blockNumber,
                    timestamp: data.timestamp,
                    transactions: await this.extractTransactionIds(data.blockNumber)
                };
            }
        }
        return null;
    }

    async getBlockAt(blockNumber: number): Promise<IBlock | null> {
        const chain = getSourceName(this.sourceId);
        const resp = await this.client.get(`/api/indexer/chain/${chain}/block-at/${blockNumber}`);
        const status = resp.data.status;
        const data = resp.data.data;
        if (status == "OK") {
            if (data) {
                return {
                    hash: data.blockHash,
                    number: data.blockNumber,
                    timestamp: data.timestamp,
                    transactions: await this.extractTransactionIds(data.blockNumber)
                };
            }
        }
        return null;
    }

    async getBlockHeight(): Promise<number> {
        const chain = getSourceName(this.sourceId);
        const resp = await this.client.get(`/api/indexer/chain/${chain}/block-height`);
        const status = resp.data.status;
        const data = resp.data.data;
        if (status === "OK") {
            return data;
        }
        return 0;
    }

    private handleInputs(data: any): TxInputOutput[] {
        const type = data.transactionType;
        const res = data.response.data;
        if (this.isUTXOchain) {
            return this.UTXOInputsOutputs(type, res, true);
        }
        if (getSourceName(this.sourceId) === "ALGO") {
            return this.ALGOInputsOutputs(type, res, true);
        }
        if (getSourceName(this.sourceId) === "XRP") {
            return this.XRPInputsOutputs(data, true);
        }
        return [];
    }

    private handleOutputs(data: any): TxInputOutput[] {
        const type = data.transactionType;
        const res = data.response.data;
        if (this.isUTXOchain) {
            return this.UTXOInputsOutputs(type, res, false);
        }
        if (getSourceName(this.sourceId) === "ALGO") {
            return this.ALGOInputsOutputs(type, res, false);
        }
        if (getSourceName(this.sourceId) === "XRP") {
            return this.XRPInputsOutputs(data, false);
        }
        return [];
    }

    private async extractTransactionIds(blockNumber: number): Promise<string[]> {
        let transactionIds: string[] = [];
        const chain = getSourceName(this.sourceId);
        const resp = await this.client.get(`/api/indexer/chain/${chain}/transactions-in-block/${blockNumber}`);
        const status = resp.data.status;
        const data = resp.data.data;
        if (status === "OK") {
            if (data) {
                data.map((item: any) => {
                    transactionIds.push(item.transactionId);
                })
            }
        }
        return transactionIds;
    }

    private get isUTXOchain() {
        return getSourceName(this.sourceId) === "BTC" ||
            getSourceName(this.sourceId) === "DOGE" ||
            getSourceName(this.sourceId) === "LTC";
    }

    private UTXOInputsOutputs(type: string, data: any, input: boolean): TxInputOutput[] {
        if (input) {
            if (type === "coinbase") {
                return [["", toBN(0)]];
            } else {
                throw Error("Not yet implemented.")
            }
        } else {
            const outputs: TxInputOutput[] = [];
            data.vout.map((item: any) => {
                outputs.push([
                    item.scriptPubKey.address,
                    toBN(Math.round((item.value || 0) * BTC_MDU).toFixed(0))
                ])
            })
            return outputs;
        }
    }

    private XRPInputsOutputs(data: any, input: boolean): TxInputOutput[] {
        const response = data.response.data.result;
        if (input) {
            if (data.isNativePayment) {
                return [[response.Account, toBN(response.Amount as any).add(toBN(response.Fee))]];
            }
            return [[response.Account, response.Fee ? toBN(response.Fee) : toBN(0)]];
        } else {
            if (data.isNativePayment) {
                const metaData = response.meta || (response as any).metaData;
                return [[response.Destination, toBN(metaData.delivered_amount as string)]];
            }
            return [["", toBN(0)]];
        }
    }

    private ALGOInputsOutputs(type: string, data: any, input: boolean): TxInputOutput[] {
        if (input) {
            if (type === "pay") {
                if (data.amt) {
                    let amount = data.amt.toString();
                    return [[hexToBase32(data.snd), toBN(data.fee || 0).add(toBN(amount))]];
                }
            }
            return [[hexToBase32(data.snd), toBN(data.fee || 0)]];
        } else {
            if (type === "pay_close") {
                return [["", toBN(0)]];
            }
            if (data.amt) {
                let amount = data.amt.toString();
                return [[hexToBase32(data.snd), toBN(data.fee || 0).add(toBN(amount))]];
            }
            return [["", toBN(0)]];
        }
    }

}