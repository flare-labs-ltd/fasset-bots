import { IBlock, IBlockChain, IBlockId, ITransaction, TxInputOutput, TX_BLOCKED, TX_FAILED, TX_SUCCESS } from "./interfaces/IBlockChain";
import axios, { AxiosInstance, AxiosRequestConfig } from "axios";
import { DEFAULT_RETRIES, DEFAULT_TIMEOUT, prefix0x, retry, sleep, toBN } from "../utils/helpers";
import { formatArgs } from "../utils/formatting";
import { logger } from "../utils/logger";
import { ChainId } from "./ChainId";
import BN from "bn.js";

// Satoshi to BTC 100_000_000
export const BTC_MDU = 1e8;

// Ripple drops 1_000_000
export const XRP_MDU = 1e6;

export class BlockChainIndexerHelperError extends Error {
    constructor(message: string) {
        super(message);
    }
}

export class BlockchainIndexerHelper implements IBlockChain {
    finalizationBlocks: number = 0;
    secondsPerBlock: number = 0;
    client: AxiosInstance;

    constructor(
        public indexerWebServerUrl: string,
        public chainId: ChainId,
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
        this.finalizationBlocks = this.finalizationBlocksByChain();
        this.secondsPerBlock = this.secondsPerBlockByChain();
    }

    async getTransaction(txHash: string): Promise<ITransaction | null> {
        const transaction = await retry(this.getTransactionFromIndexer.bind(this), [txHash], DEFAULT_RETRIES);
        logger.info(`Block chain indexer helper: retrieved transaction: ${formatArgs(transaction)}`);
        return transaction;
    }

    async getTransactionFromIndexer(txHash: string): Promise<ITransaction | null> {
        const resp = await this.client.get(`/api/indexer/transaction/${txHash}`);
        const status = resp.data.status;
        const data = resp.data.data;
        const errorMessage = resp.data.errorMessage;
        const errorDetails = resp.data.errorDetails;
        /* istanbul ignore if */
        if (status != "OK") {
            const info = `Cannot retrieve transaction with hash ${txHash}: ${status}: ${errorMessage ? errorMessage : ""}, ${errorDetails ? errorDetails : ""}`;
            logger.error(`Block chain indexer helper error: ${info}`);
            throw new BlockChainIndexerHelperError(info);
        } else if (status === "OK" && data) {
            return {
                hash: data.transactionId,
                inputs: await this.handleInputsOutputs(data, true),
                outputs: await this.handleInputsOutputs(data, false),
                reference: prefix0x(data.paymentReference),
                status: this.successStatus(data),
            };
        }
        return null;
    }

    async getTransactionBlock(txHash: string): Promise<IBlockId | null> {
        const block = await retry(this.getTransactionBlockFromIndexer.bind(this), [txHash], DEFAULT_RETRIES);
        // logger.info(`Block chain indexer helper: retrieved block: ${formatArgs(block)}`);
        return block;
    }

    async getTransactionBlockFromIndexer(txHash: string): Promise<IBlockId | null> {
        const resp = await this.client.get(`/api/indexer/transaction-block/${txHash}`);
        const status = resp.data.status;
        const data = resp.data.data;
        const errorMessage = resp.data.errorMessage;
        const errorDetails = resp.data.errorDetails;
        /* istanbul ignore if */
        if (status != "OK") {
            const info = `Cannot retrieve block for transaction hash ${txHash}: ${status}: ${errorMessage ? errorMessage : ""}, ${errorDetails ? errorDetails : ""}`;
            logger.error(`Block chain indexer helper error: ${info}`);
            throw new BlockChainIndexerHelperError(info);
        } else if (status === "OK" && data) {
            return {
                hash: data.blockHash,
                number: data.blockNumber,
            };
        }
        return null;
    }

    async getBalance(): Promise<BN> {
        logger.error("Block chain indexer helper error: Method not implemented on indexer. Use wallet.");
        throw new Error("Method not implemented on indexer. Use wallet.");
    }

    async getBlock(blockHash: string): Promise<IBlock | null> {
        const block = await retry(this.getBlockFromIndexer.bind(this), [blockHash], DEFAULT_RETRIES);
        logger.info(`Retrieved block: ${formatArgs(block)}`);
        return block;
    }

    async getBlockFromIndexer(blockHash: string): Promise<IBlock | null> {
        const resp = await this.client.get(`/api/indexer/block/${blockHash}`);
        const status = resp.data.status;
        const data = resp.data.data;
        const errorMessage = resp.data.errorMessage;
        const errorDetails = resp.data.errorDetails;
        /* istanbul ignore if */
        if (status != "OK") {
            const info = `Cannot retrieve block with hash ${blockHash}: ${status}: ${errorMessage ? errorMessage : ""}, ${errorDetails ? errorDetails : ""}`;
            logger.error(`Block chain indexer helper error: ${info}`);
            throw new BlockChainIndexerHelperError(info);
        } else if (status === "OK" && data) {
            return {
                hash: data.blockHash,
                number: data.blockNumber,
                timestamp: data.timestamp,
                transactions: await retry(this.extractTransactionIds.bind(this), [data.blockNumber], DEFAULT_RETRIES),
            };
        } else {
            return null;
        }
    }

    async getBlockAt(blockNumber: number): Promise<IBlock | null> {
        const block = await retry(this.getBlockAtFromIndexer.bind(this), [blockNumber], DEFAULT_RETRIES);
        // logger.info(`Block chain indexer helper: retrieved block: ${formatArgs(block)}`);
        return block;
    }

    async getBlockAtFromIndexer(blockNumber: number): Promise<IBlock | null> {
        const resp = await this.client.get(`/api/indexer/confirmed-block-at/${blockNumber}`);
        const status = resp.data.status;
        const data = resp.data.data;
        const errorMessage = resp.data.errorMessage;
        const errorDetails = resp.data.errorDetails;
        /* istanbul ignore if */
        if (status != "OK") {
            const info = `Cannot retrieve block at ${blockNumber}: ${status}: ${errorMessage ? errorMessage : ""}, ${errorDetails ? errorDetails : ""}`;
            logger.error(`Block chain indexer helper error: ${info}`);
            throw new BlockChainIndexerHelperError(info);
        } else if (status === "OK" && data) {
            return {
                hash: data.blockHash,
                number: data.blockNumber,
                timestamp: data.timestamp,
                transactions: await this.extractTransactionIds(data.blockNumber),
            };
        } else {
            return null;
        }
    }

    async getBlockHeight(): Promise<number> {
        const blockHeight = await retry(this.getBlockHeightFromIndexer.bind(this), [], DEFAULT_RETRIES);
        // logger.info(`Block chain indexer helper: retrieved block height: ${blockHeight}`);
        return blockHeight;
    }

    async getBlockHeightFromIndexer(): Promise<number> {
        const resp = await this.client.get(`/api/indexer/block-height`);
        const status = resp.data.status;
        const data = resp.data.data;
        const errorMessage = resp.data.errorMessage;
        const errorDetails = resp.data.errorDetails;
        /* istanbul ignore else */
        if (status === "OK" && data) {
            return data;
        } else {
            const info = `Cannot retrieve block height: ${status}: ${errorMessage ? errorMessage : ""}, ${errorDetails ? errorDetails : ""}`;
            logger.error(`Block chain indexer helper error: ${info}`);
            throw new BlockChainIndexerHelperError(info);
        }
    }

    async getTransactionsByReference(reference: string): Promise<ITransaction[] | []> {
        const txs = await retry(this.getTransactionsByReferenceFromIndexer.bind(this), [reference], DEFAULT_RETRIES);
        logger.info(`Block chain indexer helper: retrieved transactions by reference ${reference}: ${formatArgs(txs)}`);
        return txs;
    }

    async getTransactionsByReferenceFromIndexer(reference: string): Promise<ITransaction[]> {
        const returnResponse = true;
        const resp = await this.client.get(`/api/indexer/transactions?paymentReference=${reference}&returnResponse=${returnResponse}`);
        const status = resp.data.status;
        const dataArray = resp.data.data;
        const errorMessage = resp.data.errorMessage;
        const errorDetails = resp.data.errorDetails;
        const txs: ITransaction[] = [];
        if (status != "OK") {
            /* istanbul ignore next */
            const info = `Cannot retrieve transaction by reference ${reference}: ${status}: ${errorMessage ? errorMessage : ""}, ${errorDetails ? errorDetails : ""}`;
            logger.error(`Block chain indexer helper error: ${info}`);
            /* istanbul ignore next */
            throw new BlockChainIndexerHelperError(info);
        } else if (status === "OK" && dataArray.length > 0) {
            for (const tx of dataArray) {
                txs.push({
                    hash: tx.transactionId,
                    inputs: await this.handleInputsOutputs(tx, true),
                    outputs: await this.handleInputsOutputs(tx, false),
                    reference: prefix0x(tx.paymentReference),
                    status: this.successStatus(tx),
                });
            }
        }
        return txs;
    }

    async getTransactionsWithinBlockRange(from: number, to: number): Promise<ITransaction[]> {
        const txs = await retry(this.getTransactionsWithinBlockRangeFromIndexer.bind(this), [from, to], DEFAULT_RETRIES);
        logger.info(`Block chain indexer helper: retrieved transactions from ${from} to ${to}: ${formatArgs(txs)}`);
        return txs;
    }

    async getTransactionsWithinBlockRangeFromIndexer(from: number, to: number): Promise<ITransaction[]> {
        const returnResponse = true;
        const resp = await this.client.get(`/api/indexer/transactions?from=${from}&to=${to}&returnResponse=${returnResponse}`);
        const status = resp.data.status;
        const dataArray: any[] = resp.data.data;
        const txs: ITransaction[] = [];
        const errorMessage = resp.data.errorMessage;
        const errorDetails = resp.data.errorDetails;
        /* istanbul ignore if */
        if (status != "OK") {
            const info = `Cannot retrieve transactions between block ${from} and ${to}: ${status}: ${errorMessage ? errorMessage : ""}, ${errorDetails ? errorDetails : ""}`;
            logger.error(`Block chain indexer helper error: ${info}`);
            throw new BlockChainIndexerHelperError(info);
        } else /* istanbul ignore else */ if (status === "OK" && dataArray.length > 0) {
            for (const tx of dataArray) {
                /* istanbul ignore else */
                if (tx.transactionType != "EMPTY_BLOCK_INDICATOR") {
                    txs.push({
                        hash: tx.transactionId,
                        inputs: await this.handleInputsOutputs(tx, true),
                        outputs: await this.handleInputsOutputs(tx, false),
                        reference: prefix0x(tx.paymentReference),
                        status: this.successStatus(tx),
                    });
                }
            }
        }
        return txs;
    }

    private async handleInputsOutputs(data: any, input: boolean): Promise<TxInputOutput[]> {
        const type = data.transactionType;
        const res = data.response;
        switch (this.chainId) {
            case ChainId.BTC:
            case ChainId.DOGE:
            case ChainId.testBTC:
            case ChainId.testDOGE:
                return await this.UTXOInputsOutputs(type, res, input);
            case ChainId.XRP:
            case ChainId.testXRP:
                return this.XRPInputsOutputs(data, input);
            default:
                logger.error(`Block chain indexer helper error: invalid SourceId: ${this.chainId}`);
                throw new Error(`Invalid SourceId: ${this.chainId}.`);
        }
    }

    private async extractTransactionIds(blockNumber: number): Promise<string[]> {
        const transactionIds: string[] = [];
        const resp = await this.client.get(`/api/indexer/transactions?from=${blockNumber}&to=${blockNumber}`);
        const status = resp.data.status;
        const dataArray = resp.data.data;
        const errorMessage = resp.data.errorMessage;
        const errorDetails = resp.data.errorDetails;
        /* istanbul ignore if */
        if (status != "OK") {
            const info = `Cannot retrieve transaction ids from block ${blockNumber}: ${status}: ${errorMessage ? errorMessage : ""}, ${errorDetails ? errorDetails : ""}`;
            logger.error(`Block chain indexer helper error: ${info}`);
            throw new BlockChainIndexerHelperError(info);
        } else /* istanbul ignore else */ if (status === "OK" && dataArray.length > 0) {
            dataArray.map((item: any) => {
                transactionIds.push(item.transactionId);
            });
        }
        return transactionIds;
    }

    private get isUTXOchain(): boolean {
        return this.chainId === ChainId.testBTC || this.chainId === ChainId.testDOGE || this.chainId === ChainId.LTC;
    }

    private async UTXOInputsOutputs(type: string, data: any, input: boolean): Promise<TxInputOutput[]> {
        if (input) {
            if (type === "coinbase") {
                return [["", toBN(0)]];
            } else {
                const inputs: TxInputOutput[] = [];
                data.vin.map((vin: any) => {
                    const address = vin.prevout && vin.prevout.scriptPubKey.address ? vin.prevout.scriptPubKey.address : "";
                    const value = this.toBnValue(vin.prevout?.value || 0);
                    inputs.push([address, value]);
                });
                if (inputs.length == 0) return [["", toBN(0)]];
                return inputs;
            }
        } else {
            const outputs: TxInputOutput[] = [];
            data.vout.map((vout: any) => {
                outputs.push([vout.scriptPubKey.address, this.toBnValue(vout.value)]);
            });
            if (outputs.length == 0) return [["", toBN(0)]];
            return outputs;
        }
    }

    private XRPInputsOutputs(data: any, input: boolean): TxInputOutput[] {
        const response = data.response.result;
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
        const response = data.response.result;
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

    private toBnValue(value: number | undefined): BN {
        if (value === undefined) {
            return toBN(0);
        }
        return toBN(Math.round(value * BTC_MDU).toFixed(0));
    }
    async waitForUnderlyingTransactionFinalization(txHash: string, maxBlocksToWaitForTx?: number): Promise<ITransaction | null> {
        logger.info(`Block chain indexer helper: waiting for underlying transaction ${txHash} finalization for ${maxBlocksToWaitForTx} blocks`);
        const transaction = await this.waitForUnderlyingTransaction(txHash, maxBlocksToWaitForTx);
        logger.info(`Block chain indexer helper: finished waiting for underlying transaction ${txHash} finalization for ${maxBlocksToWaitForTx} blocks and retrieved ${formatArgs(transaction)}`);
        if (transaction == null) return null;
        return transaction;
    }

    private async waitForUnderlyingTransaction(txHash: string, maxBlocksToWaitForTx?: number): Promise<ITransaction | null> {
        const transaction = await this.getTransaction(txHash);
        if (transaction != null) return transaction;
        let currentBlockHeight = await this.getBlockHeight();
        const initialBlockHeight = currentBlockHeight;
        const waitBlocks = maxBlocksToWaitForTx ?? this.finalizationBlocks;
        while (currentBlockHeight < initialBlockHeight + waitBlocks) {
            await sleep(1000);
            const transaction = await this.getTransaction(txHash);
            if (transaction != null) return transaction;
            currentBlockHeight = await this.getBlockHeight();
        }
        return null;
    }

    // Values are copied from attestation configs https://gitlab.com/flarenetwork/state-connector-protocol/-/blob/main/specs/attestations/configs.md?ref_type=heads
    finalizationBlocksByChain(): number {
        switch (this.chainId) {
            case ChainId.XRP:
            case ChainId.testXRP:
                return 3;
            case ChainId.BTC:
            case ChainId.testBTC:
                return 6;
            case ChainId.DOGE:
            case ChainId.testDOGE:
                return 60;
            default:
                throw new Error(`SourceId ${this.chainId} not supported.`);
        }
    }

    // From simple-wallet https://gitlab.com/flarenetwork/simple-wallet/-/blob/main/src/utils/constants.ts?ref_type=heads
    secondsPerBlockByChain(): number {
        switch (this.chainId) {
            case ChainId.XRP:
            case ChainId.testXRP:
                return 4;
            case ChainId.BTC:
            case ChainId.testBTC:
                return 600;
            case ChainId.DOGE:
            case ChainId.testDOGE:
                return 60;
            default:
                throw new Error(`SourceId ${this.chainId} not supported.`);
        }
    }
}
