import { IBlock, IBlockChain, IBlockId, ITransaction, TxInputOutput, TX_BLOCKED, TX_FAILED, TX_SUCCESS } from "./interfaces/IBlockChain";
import axios, { AxiosInstance, AxiosRequestConfig } from "axios";
import { getSourceName, SourceId } from "../verification/sources/sources";
import { sleep, toBN } from "../utils/helpers";
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
        if (status === "OK") {
            if (data) {
                return {
                    hash: data.transactionId,
                    inputs: await this.handleInputsOutputs(data, true),
                    outputs: await this.handleInputsOutputs(data, false),
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

    async getTransactionFee(): Promise<BN> {
        const fee = await this.walletClient.getCurrentTransactionFee();
        return toBN(fee);
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

    async getTransactionsByReference(reference: string): Promise<ITransaction[] | []> {
        const chain = getSourceName(this.sourceId);
        const resp = await this.client.get(`/api/indexer/chain/${chain}/transactions/payment-reference/${reference}`);
        const status = resp.data.status;
        const data = resp.data.data;
        let txs: ITransaction[] = [];
        if (status === "OK") {
            if (data) {
                for (const tx of data) {
                    txs.push({
                        hash: tx.transactionId,
                        inputs: await this.handleInputsOutputs(tx, true),
                        outputs: await this.handleInputsOutputs(tx, false),
                        reference: tx.paymentReference,
                        status: this.successStatus(tx)
                    })
                }
            }
        }
        return txs;
    }

    async getTransactionsWithinTimestampRange(from: number, to: number) {
        const chain = getSourceName(this.sourceId);
        const resp = await this.client.get(`/api/indexer/chain/${chain}/transactions/from/${from}/to/${to}`);
        const status = resp.data.status;
        const data = resp.data.data;
        let txs: ITransaction[] = [];
        if (status === "OK") {
            if (data) {
                for (const tx of data) {
                    txs.push({
                        hash: tx.transactionId,
                        inputs: await this.handleInputsOutputs(tx, true),
                        outputs: await this.handleInputsOutputs(tx, false),
                        reference: tx.paymentReference,
                        status: this.successStatus(tx)
                    })
                }
            }
        }
        return txs;
    }

    private async handleInputsOutputs(data: any, input: boolean): Promise<TxInputOutput[]> {
        const type = data.transactionType;
        const res = data.response.data;
        switch (this.sourceId) {
            case SourceId.ALGO:
                return this.ALGOInputsOutputs(type, res, input);
            case SourceId.BTC:
            case SourceId.DOGE:
            case SourceId.LTC:
                return await this.UTXOInputsOutputs(type, res, input);
            case SourceId.XRP:
                return this.XRPInputsOutputs(data, input);
            default:
                throw new Error(`Invalid SourceId: ${this.sourceId}`)
        }
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
                    if (item.txid && item.vout >= 0) {
                        // Given a UTXO transaction indexer does additional processing on UTXO inputs.
                        // The processing is done only if the transaction contains some kind of a payment reference (OP_RETURN).
                        // https://github.com/flare-foundation/attestation-client/blob/main/lib/indexer/chain-collector-helpers/readTransaction.ts#L6-L10
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
                        }
                    }
                }
                if (inputs.length == 0) return [["", toBN(0)]];
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
            if (outputs.length == 0) return [["", toBN(0)]];
            return outputs;
        }
    }

    private XRPInputsOutputs(data: any, input: boolean): TxInputOutput[] {
        const response = data.response.data.result;
        if (input) {
            if (data.isNativePayment) {
                return [[response.Account, toBN(response.Amount as any).add(toBN(response.Fee ? response.Fee : 0))]];
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
            if ((type === "pay" || type === "pay_close") && data.amt) {
                let amount = data.amt.toString();
                return [[hexToBase32(data.snd.data), toBN(data.fee || 0).add(toBN(amount))]];
            }
            return [[hexToBase32(data.snd.data), toBN(data.fee || 0)]];
        } else {
            if (data.amt) {
                let amount = data.amt.toString();
                return [[this.ALGOReceivingAddress(type, data), toBN(amount)]];
            }
            return [["", toBN(0)]];
        }
    }

    private ALGOReceivingAddress(type: string, data: any): string {
        if (type === "pay" || type === "pay_close") {
            if (data.rcv) {
                return hexToBase32(data.rcv.data);
            }
            if (data.close) {
                return hexToBase32(data.close.data);
            }
        }
        return "";
    }

    private successStatus(data: any): number {
        if (this.isUTXOchain || getSourceName(this.sourceId) === "ALGO") {
            return TX_SUCCESS;
        }
        // https://xrpl.org/transaction-results.html
        const response = data.response.data.result;
        let metaData = response.meta || (response as any).metaData;
        let result = metaData.TransactionResult;
        if (result === "tesSUCCESS") {
            // https://xrpl.org/tes-success.html
            return TX_SUCCESS;
        }
        if (result.startsWith("tec")) {
            // https://xrpl.org/tec-codes.html
            switch (result) {
                case "tecDST_TAG_NEEDED":
                case "tecNO_DST":
                case "tecNO_DST_INSUF_XRP":
                case "tecNO_PERMISSION":
                    return TX_BLOCKED;
                default:
                    return TX_FAILED;
            }
        }
        // Other codes: tef, tel, tem, ter are not applied to ledgers
        return TX_FAILED;
    }

    async waitForUnderlyingTransactionFinalization(txHash: string, maxBlocksToWaitForTx?: number) {
        const transaction = await this.waitForUnderlyingTransaction(txHash, maxBlocksToWaitForTx);
        if (transaction == null) return null;
        return transaction;
    }

    private async waitForUnderlyingTransaction(txHash: string, maxBlocksToWaitForTx?: number) {
        const transaction = await this.getTransaction(txHash);
        if (transaction != null) return transaction;
        let currentBlockHeight = await this.getBlockHeight();
        const waitBlocks = maxBlocksToWaitForTx ?? Math.max(this.finalizationBlocks, 1);
        while (currentBlockHeight < currentBlockHeight + waitBlocks) {
            await sleep(1000);
            const transaction = await this.getTransaction(txHash);
            if (transaction != null) return transaction;
            currentBlockHeight = await this.getBlockHeight();
        }
        return null;
    }
}