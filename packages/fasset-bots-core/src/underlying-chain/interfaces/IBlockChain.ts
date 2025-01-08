import BN from "bn.js";

export type TxInputOutput = [address: string, amount: BN];

// possible transaction status values
export const TX_SUCCESS = 0;
export const TX_FAILED = 1;
export const TX_BLOCKED = 2;

export interface ITransaction {
    // Transaction hash.
    hash: string;

    // Transaction inputs and outputs.
    // For UTXO chains, there can be several inputs and outputs and same address may appear several times.
    // Fot (all?) other chains, there is only one input and output.
    // Always: `fee := sum(input amounts) - sum(output amounts) >= 0`.
    inputs: TxInputOutput[];
    outputs: TxInputOutput[];

    // Payment reference (a 256 bit number with defined prefix or `null` if not included)
    reference: string | null;

    // Transaction status (only important on chains like Ethereum, where failed transactions are recorded and charged, otherwise always 0).
    // TX_SUCCESS (0) = success, TX_FAILED (1) = failure (sender's fault), TX_BLOCKED (2) = failure (receiver's fault, e.g. blocking contract)
    status: number;
}

export interface IBlockId {
    // Block hash.
    hash: string;

    // Block number.
    number: number;
}

export interface IBlock {
    // Block hash.
    hash: string;

    // Block number.
    number: number;

    // Unix block timestamp (seconds since 1.1.1970).
    timestamp: number;

    // List of transaction hashes, included in this block.
    transactions: string[];
}

export interface IBlockChain {
    /**
     * Estimated number of blocks to reach finalization.
     */
    finalizationBlocks: number;

    /**
     * Estimated number of seconds per block.
     */
    secondsPerBlock: number;

    /**
     * Return the transaction with given hash or `null` if the transaction doesn't exist.
     * Only finalized transactions are guaranteed to be available.
     */
    getTransaction(txHash: string): Promise<ITransaction | null>;

    /**
     * Return the block hash of the transaction with given hash or `null` if the transaction doesn't exist.
     * Only finalized transactions are guaranteed to be available.
     */
    getTransactionBlock(txHash: string): Promise<IBlockId | null>;

    /**
     * Return the balance of an address on the chain. If the address does not exist, returns 0.
     */
    getBalance(address: string): Promise<BN>;

    /**
     * Return block with given hash.
     */
    getBlock(blockHash: string): Promise<IBlock | null>;

    /**
     * Return block with given block number. Only finalized blocks are guaranteed to be available.
     */
    getBlockAt(blockNumber: number): Promise<IBlock | null>;

    /**
     * Return the (approximate) current block height (last mined block number).
     */
    getCurrentBlockHeight(): Promise<number>;

    /**
     * Return the number of the last finalized block (it should always be available in the indexer).
     */
    getLastFinalizedBlockNumber(): Promise<number>;
}
