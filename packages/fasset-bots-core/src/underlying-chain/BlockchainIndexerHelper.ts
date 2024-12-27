import { IBlock, IBlockChain, IBlockId, ITransaction, TxInputOutput, TX_BLOCKED, TX_FAILED, TX_SUCCESS } from "./interfaces/IBlockChain";
import axios, { AxiosInstance } from "axios";
import { DEFAULT_RETRIES, prefix0x, requireNotNull, retry, sleep, toBN, ZERO_BYTES32 } from "../utils/helpers";
import { formatArgs } from "../utils/formatting";
import { logger } from "../utils/logger";
import { ChainId } from "./ChainId";
import BN from "bn.js";
import { createAxiosConfig, tryWithClients } from "@flarelabs/simple-wallet";

// Satoshi to BTC 100_000_000
export const BTC_MDU = 1e8;

// Ripple drops 1_000_000
export const XRP_MDU = 1e6;

export class BlockChainIndexerHelperError extends Error {
    constructor(message: string) {
        super(message);
    }
}

export interface ApiWrapper<T> {
    status: string;
    data?: T;
    errorMessage?: string;
}

export interface ApiPaginated<T> {
    items: T[];
    count: number;
    limit: number;
    offset: number;
}

interface IndexerTransaction {
    id: number;
    chainType: number;
    transactionId: string;
    blockNumber: number;
    timestamp: number;
    paymentReference: string | null;
    response: any;
    isNativePayment: boolean;
    transactionType: string;
}

interface IndexerBlockRange {
    first: number;
    last: number;
    tip: number;
}

interface IndexerBlock {
    blockNumber: number;
    blockHash: string;
    timestamp: number;
    transactions: number;
    confirmed: boolean;
    numberOfConfirmations: number;
}

export class BlockchainIndexerHelper implements IBlockChain {
    finalizationBlocks: number = 0;
    secondsPerBlock: number = 0;
    clients: AxiosInstance[] = [];

    constructor(
        public indexerWebServerUrls: string[],
        public chainId: ChainId,
        private readonly indexerWebServerApiKeys: string[]
    ) {
        // set client
        for (const [index, url] of indexerWebServerUrls.entries()) {
            this.clients.push(axios.create(createAxiosConfig(url, indexerWebServerApiKeys[index])));
        }
        this.finalizationBlocks = this.finalizationBlocksByChain();
        this.secondsPerBlock = this.secondsPerBlockByChain();
    }

    async getTransaction(txHash: string): Promise<ITransaction | null> {
        const transaction = await retry(this.getTransactionFromIndexer.bind(this), [txHash], DEFAULT_RETRIES);
        logger.info(`Block chain indexer helper: retrieved transaction: ${formatArgs(transaction)}`);
        return transaction;
    }

    async getTransactionFromIndexer(txHash: string): Promise<ITransaction | null> {
        const resp = await tryWithClients(
            this.clients,
            (client: AxiosInstance) => client.get<ApiWrapper<IndexerTransaction>>(`/api/indexer/transaction/${txHash}`),
            "getTransactionFromIndexer"
        );
        const status = resp.data.status;
        const data = resp.data.data;
        /* istanbul ignore if */
        if (status != "OK") {
            const errorMessage = resp.data.errorMessage;
            if (errorMessage === "Transaction not found") {
                return null;
            }
            const info = `Cannot retrieve transaction with hash ${txHash}: ${status}: ${errorMessage ? errorMessage : ""}`;
            logger.error(`Block chain indexer helper error: ${info}`);
            throw new BlockChainIndexerHelperError(info);
        } else if (status === "OK" && data) {
            return await this.convertToITransaction(data);
        }
        return null;
    }

    async getTransactionBlock(txHash: string): Promise<IBlockId | null> {
        const block = await retry(this.getTransactionBlockFromIndexer.bind(this), [txHash], DEFAULT_RETRIES);
        // logger.info(`Block chain indexer helper: retrieved block: ${formatArgs(block)}`);
        return block;
    }

    async getTransactionBlockFromIndexer(txHash: string): Promise<IBlockId | null> {
        const resp = await tryWithClients(
            this.clients,
            (client: AxiosInstance) => client.get<ApiWrapper<IndexerBlock>>(`/api/indexer/transaction-block/${txHash}`),
            "getTransactionBlockFromIndexer"
        );
        const status = resp.data.status;
        const data = resp.data.data;
        /* istanbul ignore if */
        if (status != "OK") {
            const errorMessage = resp.data.errorMessage;
            if (errorMessage === "Block not found" || errorMessage === "Transaction not found") {
                return null;
            }
            const info = `Cannot retrieve block for transaction hash ${txHash}: ${status}: ${errorMessage ? errorMessage : ""}`;
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
        const resp = await tryWithClients(
            this.clients,
            (client: AxiosInstance) => client.get<ApiWrapper<IndexerBlock>>(`/api/indexer/block/${blockHash}`),
            "getBlockFromIndexer"
        );
        const status = resp.data.status;
        const data = resp.data.data;
        /* istanbul ignore if */
        if (status != "OK") {
            const errorMessage = resp.data.errorMessage;
            if (errorMessage === "Block not found") {
                return null;
            }
            const info = `Cannot retrieve block with hash ${blockHash}: ${status}: ${errorMessage ? errorMessage : ""}`;
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
        const resp = await tryWithClients(
            this.clients,
            (client: AxiosInstance) => client.get<ApiWrapper<IndexerBlock>>(`/api/indexer/confirmed-block-at/${blockNumber}`),
            "getBlockAtFromIndexer"
        );
        const status = resp.data.status;
        const data = resp.data.data;
        /* istanbul ignore if */
        if (status != "OK") {
            const errorMessage = resp.data.errorMessage;
            if (errorMessage === "Block not found") {
                return null;
            }
            const info = `Cannot retrieve block at ${blockNumber}: ${status}: ${errorMessage ? errorMessage : ""}`;
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
        return blockHeight;
    }

    async getBlockHeightFromIndexer(): Promise<number> {
        const resp = await tryWithClients(
            this.clients,
            (client: AxiosInstance) => client.get<ApiWrapper<number>>(`/api/indexer/block-height-indexed`),
            "getBlockHeightFromIndexer"
        );
        const status = resp.data.status;
        const data = resp.data.data;
        /* istanbul ignore else */
        if (status === "OK" && data) {
            return data;
        } else {
            const errorMessage = resp.data.errorMessage;
            const info = `Cannot retrieve block height: ${status}: ${errorMessage ? errorMessage : ""}`;
            logger.error(`Block chain indexer helper error: ${info}`);
            throw new BlockChainIndexerHelperError(info);
        }
    }

    async getBlockRangeRaw(): Promise<IndexerBlockRange> {
        const resp = await tryWithClients(
            this.clients,
            (client: AxiosInstance) => client.get<ApiWrapper<IndexerBlockRange>>(`/api/indexer/block-range`),
            "getBlockRangeRaw"
        );
        const status = resp.data.status;
        const data = resp.data.data;
        /* istanbul ignore else */
        if (status === "OK" && data) {
            return data;
        } else {
            const errorMessage = resp.data.errorMessage;
            const info = `Cannot retrieve block range: ${status}: ${errorMessage ? errorMessage : ""}`;
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
        return await this.getTransactionList(`paymentReference=${reference}&returnResponse=${returnResponse}`,
            tx => this.convertToITransaction(tx),
            "getTransactionsByReferenceFromIndexer",
            `Cannot retrieve transaction by reference ${reference}`);
    }

    async getTransactionsWithinBlockRange(from: number, to: number): Promise<ITransaction[]> {
        if (from > to) {
            return [];  // no need calling api for empty range
        }
        const txs = await retry(this.getTransactionsWithinBlockRangeFromIndexer.bind(this), [from, to], DEFAULT_RETRIES);
        logger.info(`Block chain indexer helper: retrieved transactions from ${from} to ${to}: ${txs.length}`);
        return txs;
    }

    async getTransactionsWithinBlockRangeFromIndexer(from: number, to: number): Promise<ITransaction[]> {
        const returnResponse = true;
        return await this.getTransactionList(`from=${from}&to=${to}&returnResponse=${returnResponse}`,
            tx => this.convertToITransaction(tx),
            "getTransactionsWithinBlockRangeFromIndexer",
            `Cannot retrieve transactions between block ${from} and ${to}`);
    }

    private async getTransactionList<T>(urlQuery: string, convert: (tx: IndexerTransaction) => T | Promise<T>, methodName: string, errorExplanation: string) {
        const chunkSize = 100;
        const txs: T[] = [];
        for (let offset = 0; ;) {
            const resp = await tryWithClients(
                this.clients,
                (client: AxiosInstance) => client.get<ApiWrapper<ApiPaginated<IndexerTransaction>>>(`/api/indexer/transaction?${urlQuery}&limit=${chunkSize}&offset=${offset}`),
                methodName
            );
            const status = resp.data.status;
            if (status != "OK") {
                const info = `${errorExplanation}: ${status}: ${resp.data.errorMessage ?? ""}`;
                logger.error(`Block chain indexer helper error: ${info}`);
                throw new BlockChainIndexerHelperError(info);
            } else if (status === "OK") {
                const data = requireNotNull(resp.data.data);
                for (const tx of data.items) {
                    txs.push(await convert(tx));
                }
                if (data.items.length == 0) {
                    break;
                }
                offset = data.offset + data.limit;
            }
        }
        return txs;
    }

    private async convertToITransaction(tx: IndexerTransaction): Promise<ITransaction> {
        return {
            hash: this.normalizeTxHash(tx.transactionId),
            inputs: await this.handleInputsOutputs(tx, true),
            outputs: await this.handleInputsOutputs(tx, false),
            reference: tx.paymentReference != null ? prefix0x(tx.paymentReference) : ZERO_BYTES32,
            status: this.successStatus(tx),
        };
    }

    private async handleInputsOutputs(data: IndexerTransaction, input: boolean): Promise<TxInputOutput[]> {
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
        return await this.getTransactionList(`from=${blockNumber}&to=${blockNumber}`,
            tx => this.normalizeTxHash(tx.transactionId),
            "extractTransactionIds",
            `Cannot retrieve transaction ids from block ${blockNumber}`);
    }

    private get isUTXOchain(): boolean {
        return this.chainId === ChainId.testBTC || this.chainId === ChainId.testDOGE || this.chainId === ChainId.testLTC
            || this.chainId === ChainId.BTC || this.chainId === ChainId.DOGE || this.chainId === ChainId.LTC;
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

    private XRPInputsOutputs(data: IndexerTransaction, input: boolean): TxInputOutput[] {
        const response = data.response.result;
        if (input) {
            if (data.isNativePayment) {
                return [[response.Account, toBN(response.Amount).add(toBN(response.Fee || 0))]];
            }
            return [[response.Account, toBN(response.Fee || 0)]];
        } else {
            if (data.isNativePayment && this.successStatus(data) === TX_SUCCESS) {
                /* istanbul ignore next */
                const metaData = response.meta || response.metaData;
                return [[response.Destination, toBN(metaData.delivered_amount as string)]];
            }
            return [["", toBN(0)]];
        }
    }

    private successStatus(data: IndexerTransaction): number {
        if (this.isUTXOchain) {
            return TX_SUCCESS;
        }
        // https://xrpl.org/transaction-results.html
        const response = data.response.result;
        /* istanbul ignore next */
        const metaData = response.meta || response.metaData;
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

    normalizeTxHash(txhash: string) {
        if (this.chainId === ChainId.XRP || this.chainId === ChainId.testXRP) {
            return txhash.toUpperCase();
        }
        return txhash;
    }
}
