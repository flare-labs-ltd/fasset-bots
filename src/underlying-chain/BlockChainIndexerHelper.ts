import { IBlock, IBlockChain, IBlockId, ITransaction, TxInputOutput } from "./interfaces/IBlockChain";
import axios, { AxiosInstance, AxiosRequestConfig } from "axios";
import { getSourceName, SourceId } from "../verification/sources/sources";
import { toBN } from "../utils/helpers";
import { WalletClient } from "simple-wallet";
import { BTC_MDU, hexToBase32, MccClient, TransactionSuccessStatus, UtxoTransaction } from "@flarenetwork/mcc";

const DEFAULT_TIMEOUT = 15000;

export class BlockChainIndexerHelper implements IBlockChain {

    finalizationBlocks: number = 0;
    secondsPerBlock: number = 0;
    client: AxiosInstance;

    constructor(
        public indexerWebServerUrl: string,
        public sourceId: SourceId,
        public walletClient: WalletClient,
        public mccClient: MccClient //backup for UTXO chains 
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
        if (status === "OK") {
            if (data) {
                return {
                    hash: data.transactionId,
                    inputs: await this.handleInputs(data),
                    outputs: await this.handleOutputs(data),
                    reference: data.paymentReference,
                    status: this.successStatus(data)
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
        if (status === "OK") {
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
        if (status === "OK") {
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
        if (status === "OK") {
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

    private async handleInputs(data: any): Promise<TxInputOutput[]> {
        const type = data.transactionType;
        const res = data.response.data;
        if (this.isUTXOchain) {
            return await this.UTXOInputsOutputs(type, res, true);
        }
        if (getSourceName(this.sourceId) === "ALGO") {
            return this.ALGOInputsOutputs(type, res, true);
        }
        if (getSourceName(this.sourceId) === "XRP") {
            return this.XRPInputsOutputs(data, true);
        }
        return [];
    }

    private async handleOutputs(data: any): Promise<TxInputOutput[]> {
        const type = data.transactionType;
        const res = data.response.data;
        if (this.isUTXOchain) {
            return await this.UTXOInputsOutputs(type, res, false);
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

    private async UTXOInputsOutputs(type: string, data: any, input: boolean): Promise<TxInputOutput[]> {
        if (input) {
            if (type === "coinbase") {
                return [["", toBN(0)]];
            } else {
                const chain = getSourceName(this.sourceId);
                const inputs: TxInputOutput[] = [];
                for (let item of data.vin) {
                    if (item.txid && item.vout) {
                        const resp = await this.client.get(`/api/indexer/chain/${chain}/transaction/${item.txid}`);
                        const status = resp.data.status;
                        const data = resp.data.data;
                        if (status === "OK" && data) {
                            const vout = data.response.data.vout;
                            const elt = vout[item.vout];
                            inputs.push([
                                elt.scriptPubKey.address ? elt.scriptPubKey.address : "",
                                toBN(Math.round((elt.value || 0) * BTC_MDU).toFixed(0))
                            ])
                        } else { // Indexer does not have stored this tx anymore. Check via mcc
                            const tx = await this.mccClient.getTransaction(item.txid) as UtxoTransaction;
                            const vout = tx.data.vout;
                            const elt = vout[item.vout];
                            inputs.push([
                                elt.scriptPubKey.address ? elt.scriptPubKey.address : "",
                                toBN(Math.round((elt.value || 0) * BTC_MDU).toFixed(0))
                            ])
                        }
                    }
                }
                return inputs;
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

    private successStatus(data: any): TransactionSuccessStatus {
        if (this.isUTXOchain || getSourceName(this.sourceId) === "ALGO") {
            return TransactionSuccessStatus.SUCCESS;
        }
        // https://xrpl.org/transaction-results.html
        const response = data.response.data.result;
        let metaData = response.meta || (response as any).metaData;
        let result = metaData.TransactionResult;
        if (result === "tesSUCCESS") {
            // https://xrpl.org/tes-success.html
            return TransactionSuccessStatus.SUCCESS;
        }
        if (result.startsWith("tec")) {
            // https://xrpl.org/tec-codes.html
            switch (result) {
                case "tecDST_TAG_NEEDED":
                case "tecNO_DST":
                case "tecNO_DST_INSUF_XRP":
                case "tecNO_PERMISSION":
                    return TransactionSuccessStatus.RECEIVER_FAILURE;
                default:
                    return TransactionSuccessStatus.SENDER_FAILURE;
            }
        }
        // Other codes: tef, tel, tem, ter are not applied to ledgers
        return TransactionSuccessStatus.SENDER_FAILURE;
    }

}