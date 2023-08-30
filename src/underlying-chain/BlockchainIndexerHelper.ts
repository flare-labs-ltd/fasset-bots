import { IBlock, IBlockChain, IBlockId, ITransaction, TxInputOutput, TX_BLOCKED, TX_FAILED, TX_SUCCESS } from "./interfaces/IBlockChain";
import axios, { AxiosInstance, AxiosRequestConfig } from "axios";
import { getSourceName, SourceId } from "../verification/sources/sources";
import { DEFAULT_TIMEOUT, sleep, toBN } from "../utils/helpers";
import { BTC_MDU } from "@flarenetwork/mcc";

export class BlockchainIndexerHelper implements IBlockChain {
    finalizationBlocks: number = 0;
    secondsPerBlock: number = 0;
    client: AxiosInstance;

    constructor(
        public indexerWebServerUrl: string,
        public sourceId: SourceId,
        private indexerWebServerApiKey: string
    ) {
        const createAxiosConfig: AxiosRequestConfig = {
            baseURL: indexerWebServerUrl,
            timeout: DEFAULT_TIMEOUT,
            headers: {
                "Content-Type": "application/json",
                "X-API-KEY": this.indexerWebServerApiKey,
            },

            validateStatus: function (status: number) {
                /* istanbul ignore next */
                return (status >= 200 && status < 300) || status == 500;
            },
        };
        // set client
        this.client = axios.create(createAxiosConfig);
    }

    async getTransaction(txHash: string): Promise<ITransaction | null> {
        const resp = await this.client.get(`/api/indexer/transaction/${txHash}`);
        const status = resp.data.status;
        const data = resp.data.data;
        if (status === "OK" && data) {
            return {
                hash: data.transactionId,
                inputs: await this.handleInputsOutputs(data, true),
                outputs: await this.handleInputsOutputs(data, false),
                reference: data.paymentReference,
                status: this.successStatus(data),
            };
        }
        return null;
    }

    async getTransactionBlock(txHash: string): Promise<IBlockId | null> {
        const resp = await this.client.get(`/api/indexer/transaction-block/${txHash}`);
        const status = resp.data.status;
        const data = resp.data.data;
        if (status === "OK" && data) {
            return {
                hash: data.blockHash,
                number: data.blockNumber,
            };
        }
        return null;
    }

    async getBalance(): Promise<BN> {
        throw new Error("Method not implemented on indexer. Use wallet.");
    }

    async getBlock(blockHash: string): Promise<IBlock | null> {
        const resp = await this.client.get(`/api/indexer/block/${blockHash}`);
        const status = resp.data.status;
        const data = resp.data.data;
        if (status === "OK" && data) {
            return {
                hash: data.blockHash,
                number: data.blockNumber,
                timestamp: data.timestamp,
                transactions: await this.extractTransactionIds(data.blockNumber),
            };
        }
        return null;
    }

    async getBlockAt(blockNumber: number): Promise<IBlock | null> {
        const resp = await this.client.get(`/api/indexer/confirmed-block-at/${blockNumber}`);
        const status = resp.data.status;
        const data = resp.data.data;
        if (status === "OK" && data) {
            return {
                hash: data.blockHash,
                number: data.blockNumber,
                timestamp: data.timestamp,
                transactions: await this.extractTransactionIds(data.blockNumber),
            };
        }
        return null;
    }

    async getBlockHeight(): Promise<number> {
        const resp = await this.client.get(`/api/indexer/block-height`);
        const status = resp.data.status;
        const data = resp.data.data;
        /* istanbul ignore else */
        if (status === "OK" && data) {
            return data;
        }
        /* istanbul ignore next */
        return 0;
    }

    async getTransactionsByReference(reference: string): Promise<ITransaction[] | []> {
        const returnResponse = true;
        const resp = await this.client.get(`/api/indexer/transactions?paymentReference=${reference}&returnResponse=${returnResponse}`);
        const status = resp.data.status;
        const dataArray = resp.data.data;
        const txs: ITransaction[] = [];
        if (status === "OK" && dataArray.length > 0) {
            for (const tx of dataArray) {
                txs.push({
                    hash: tx.transactionId,
                    inputs: await this.handleInputsOutputs(tx, true),
                    outputs: await this.handleInputsOutputs(tx, false),
                    reference: tx.paymentReference,
                    status: this.successStatus(tx),
                });
            }
        }
        return txs;
    }

    async getTransactionsWithinBlockRange(from: number, to: number): Promise<ITransaction[]> {
        const returnResponse = true;
        const resp = await this.client.get(`/api/indexer/transactions?from=${from}&to=${to}&returnResponse=${returnResponse}`);
        const status = resp.data.status;
        const dataArray: any[] = resp.data.data;
        const txs: ITransaction[] = [];
        /* istanbul ignore else */
        if (status === "OK" && dataArray.length > 0) {
            for (const tx of dataArray) {
                txs.push({
                    hash: tx.transactionId,
                    inputs: await this.handleInputsOutputs(tx, true),
                    outputs: await this.handleInputsOutputs(tx, false),
                    reference: tx.paymentReference,
                    status: this.successStatus(tx),
                });
            }
        }
        return txs;
    }

    private async handleInputsOutputs(data: any, input: boolean): Promise<TxInputOutput[]> {
        const type = data.transactionType;
        const res = data.response.data;
        switch (this.sourceId) {
            case SourceId.BTC:
            case SourceId.DOGE:
                return await this.UTXOInputsOutputs(type, res, input);
            case SourceId.XRP:
                return this.XRPInputsOutputs(data, input);
            default:
                throw new Error(`Invalid SourceId: ${this.sourceId}.`);
        }
    }

    private async extractTransactionIds(blockNumber: number): Promise<string[]> {
        const transactionIds: string[] = [];
        const resp = await this.client.get(`/api/indexer/transactions?from=${blockNumber}&to=${blockNumber}`);
        const status = resp.data.status;
        const dataArray = resp.data.data;
        /* istanbul ignore else */
        if (status === "OK" && dataArray.length > 0) {
            dataArray.map((item: any) => {
                transactionIds.push(item.transactionId);
            });
        }
        return transactionIds;
    }

    private get isUTXOchain(): boolean {
        return getSourceName(this.sourceId) === "BTC" || getSourceName(this.sourceId) === "DOGE" || getSourceName(this.sourceId) === "LTC";
    }

    private async UTXOInputsOutputs(type: string, data: any, input: boolean): Promise<TxInputOutput[]> {
        if (input) {
            if (type === "coinbase") {
                return [["", toBN(0)]];
            } else {
                const inputs: TxInputOutput[] = [];
                for (const item of data.vin) {
                    /* istanbul ignore else */
                    if (item.txid && item.vout >= 0) {
                        // Given a UTXO transaction indexer does additional processing on UTXO inputs.
                        // The processing is done only if the transaction contains some kind of a payment reference (OP_RETURN).
                        // https://github.com/flare-foundation/attestation-client/blob/main/lib/indexer/chain-collector-helpers/readTransaction.ts#L6-L10
                        const resp = await this.client.get(`/api/indexer/transaction/${item.txid}`);
                        const status = resp.data.status;
                        const data = resp.data.data;
                        if (status === "OK" && data) {
                            const vout = data.response.data.vout;
                            const elt = vout[item.vout];
                            /* istanbul ignore next */
                            const value = elt.value || 0;
                            inputs.push([
                                /* istanbul ignore next */
                                elt.scriptPubKey.address ? elt.scriptPubKey.address : "",
                                toBN(Math.round(value * BTC_MDU).toFixed(0)),
                            ]);
                        }
                    }
                }
                if (inputs.length == 0) return [["", toBN(0)]];
                return inputs;
            }
        } else {
            const outputs: TxInputOutput[] = [];
            data.vout.map((item: any) => {
                /* istanbul ignore next */
                const value = item.value || 0;
                outputs.push([item.scriptPubKey.address, toBN(Math.round(value * BTC_MDU).toFixed(0))]);
            });
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
            if (data.isNativePayment && this.successStatus(data) === TX_SUCCESS) {
                /* istanbul ignore next */
                const metaData = response.meta || (response as any).metaData;
                return [[response.Destination, toBN(metaData.delivered_amount as string)]];
            }
            return [["", toBN(0)]];
        }
    }

    private successStatus(data: any): number {
        if (this.isUTXOchain) {
            return TX_SUCCESS;
        }
        // https://xrpl.org/transaction-results.html
        const response = data.response.data.result;
        /* istanbul ignore next */
        const metaData = response.meta || (response as any).metaData;
        const result = metaData.TransactionResult;
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

    async waitForUnderlyingTransactionFinalization(txHash: string, maxBlocksToWaitForTx?: number): Promise<ITransaction | null> {
        const transaction = await this.waitForUnderlyingTransaction(txHash, maxBlocksToWaitForTx);
        if (transaction == null) return null;
        return transaction;
    }

    private async waitForUnderlyingTransaction(txHash: string, maxBlocksToWaitForTx?: number): Promise<ITransaction | null> {
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
