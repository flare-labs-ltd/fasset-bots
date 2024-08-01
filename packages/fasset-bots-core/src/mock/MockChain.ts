import Web3 from "web3";
import { IBlock, IBlockChain, IBlockId, ITransaction, TxInputOutput, TX_FAILED, TX_SUCCESS } from "../underlying-chain/interfaces/IBlockChain";
import { BNish, BN_ZERO, fail, systemTimestamp, toBN } from "../utils/helpers";
import type { IBlockChainWallet, TransactionOptionsWithFee, SpentReceivedObject } from "../underlying-chain/interfaces/IBlockChainWallet";
import BN from "bn.js";
import { TransactionInfo, TransactionStatus } from "@flarelabs/simple-wallet";

export type MockTransactionOptions = { status?: number };
export type MockTransactionOptionsWithFee = TransactionOptionsWithFee & { status?: number };

export interface MockChainTransaction {
    hash: string;
    inputs: TxInputOutput[];
    outputs: TxInputOutput[];
    reference: string | null;
    status: number; // 0 = success, 1 = failure (sender's fault), 2 = failure (receiver's fault)
}

export interface MockChainBlock {
    hash: string;
    number: number;
    timestamp: number;
    transactions: MockChainTransaction[];
}

/**
 * A simple blockchain mock, to simulate operations needed in fasset system.
 * Supports multi source/dest transactions, payment references and failed transaction records.
 * Everything is linear here - no support for complex concepts like finalization or forking
 * (these are handled in attestation system and are not really visible in fasset system).
 */
export class MockChain implements IBlockChain {
    static deepCopyWithObjectCreate = true;

    constructor(
        currentTime?: BN
    ) {
        if (currentTime) {
            this.skipTimeTo(currentTime.toNumber());
        }
    }

    blocks: MockChainBlock[] = [];
    blockIndex: { [hash: string]: number } = {};
    transactionIndex: { [hash: string]: [block: number, txIndex: number] } = {};
    nonces: { [address: string]: number } = {};
    balances: { [address: string]: BN } = {};
    timestampSkew: number = 0;   // how much the timestamp is ahead of system time
    nextBlockTransactions: MockChainTransaction[] = [];

    // some settings that can be tuned for tests
    finalizationBlocks: number = 0;
    secondsPerBlock: number = 1;
    requiredFee: BN = BN_ZERO;   // this much gas/fee will be used at each transaction
    estimatedGasPrice: BN = BN_ZERO;
    automine: boolean = true;

    async getTransaction(txHash: string): Promise<ITransaction | null> {
        const [block, ind] = this.transactionIndex[txHash] ?? [null, null];
        if (block == null || ind == null) return null;
        return this.blocks[block].transactions[ind];
    }

    async getTransactionBlock(txHash: string): Promise<IBlockId | null> {
        const [block, _] = this.transactionIndex[txHash] ?? [null, null];
        if (block == null) return null;
        return { number: block, hash: this.blocks[block].hash };
    }

    async getBalance(address: string): Promise<BN> {
        return this.balances[address] ?? BN_ZERO;
    }

    async getBlock(blockHash: string): Promise<IBlock | null> {
        const index = this.blockIndex[blockHash];
        return index != null ? this.toIBlock(this.blocks[index]) : null;
    }

    async getBlockAt(blockNumber: number): Promise<IBlock | null> {
        return blockNumber >= 0 && blockNumber < this.blocks.length ? this.toIBlock(this.blocks[blockNumber]) : null;
    }

    async getBlockHeight(): Promise<number> {
        return this.blocks.length - 1;
    }

    ////////////////////////////////////////////////////////////////////////////////
    // Mock methods

    addTransaction(transaction: MockChainTransaction) {
        this.nextBlockTransactions.push(transaction);
        if (this.automine) {
            this.mine();
        }
    }

    mine(blocks: number = 1) {
        for (let i = 0; i < blocks; i++) {
            this.addBlock(this.nextBlockTransactions);
            this.nextBlockTransactions = [];
        }
    }

    mineTo(blockNo: number) {
        const current = this.blockHeight();
        if (blockNo <= current) return;
        if (blockNo - current > 1000) throw new Error(`Mining too many blocks: ${blockNo - current}`);
        this.mine(blockNo - current);
    }

    miningTimer: NodeJS.Timeout | null = null;

    timedMining() {
        return this.miningTimer != null;
    }

    enableTimedMining(intervalMS: number) {
        if (this.miningTimer != null) this.disableTimedMining();
        setInterval(() => this.mine(), intervalMS);
    }

    disableTimedMining() {
        if (this.miningTimer != null) clearInterval(this.miningTimer);
        this.miningTimer = null;
    }

    createTransactionHash(inputs: TxInputOutput[], outputs: TxInputOutput[], reference: string | null): string {
        // build data structure to hash
        const data = {
            spent: inputs.map(([address, value]) => [address, this.nonces[address] ?? 0, value.toString(10)]),
            received: outputs.map(([address, value]) => [address, value.toString(10)]),
            reference: reference
        };
        // update source address nonces
        for (const [src, _] of inputs) {
            this.nonces[src] = (this.nonces[src] ?? 0) + 1;
        }
        // calculate hash
        return Web3.utils.keccak256(JSON.stringify(data));
    }

    skipTime(timeDelta: number) {
        this.timestampSkew += timeDelta;
        this.mine();
    }

    skipTimeTo(timestamp: number) {
        this.timestampSkew = timestamp - systemTimestamp();
        this.mine();
    }

    mint(address: string, value: BNish) {
        this.balances[address] = (this.balances[address] ?? BN_ZERO).add(toBN(value));
    }

    blockHeight() {
        return this.blocks.length - 1;
    }

    blockWithHash(blockHash: string) {
        const index = this.blockIndex[blockHash];
        return index != null ? this.blocks[index] : null;
    }

    lastBlockTimestamp() {
        return this.blocks.length > 0
            ? this.blocks[this.blocks.length - 1].timestamp
            : systemTimestamp() + this.timestampSkew - this.secondsPerBlock;    // so that new block will be exactly systemTimestamp + skew
    }

    nextBlockTimestamp() {
        return Math.max(systemTimestamp() + this.timestampSkew, this.lastBlockTimestamp() + this.secondsPerBlock);
    }

    currentTimestamp() {
        return Math.max(systemTimestamp() + this.timestampSkew, this.lastBlockTimestamp());
    }

    private addBlock(transactions: MockChainTransaction[]) {
        // check that balances stay positive
        for (let i = 0; i < transactions.length; i++) {
            const transaction = transactions[i];
            if (transaction.status !== TX_SUCCESS) continue;
            const changedBalances: { [address: string]: BN } = {};
            for (const [src, value] of transaction.inputs) {
                changedBalances[src] = (changedBalances[src] ?? this.balances[src] ?? BN_ZERO).sub(value);
            }
            for (const [dest, value] of transaction.outputs) {
                changedBalances[dest] = (changedBalances[dest] ?? this.balances[dest] ?? BN_ZERO).add(value);
            }
            const negative = Object.entries(changedBalances).filter(([address, value]) => value.isNeg());
            if (negative.length > 0) {
                transaction.status = TX_FAILED;
            } else {
                // update balances
                Object.assign(this.balances, changedBalances);
            }
        }
        // update transaction index
        for (let i = 0; i < transactions.length; i++) {
            this.transactionIndex[transactions[i].hash] = [this.blocks.length, i];
        }
        // create new block
        const number = this.blocks.length;
        const timestamp = this.newBlockTimestamp();
        const hash = Web3.utils.keccak256(JSON.stringify({ number, timestamp, transactions: transactions.map(tx => tx.hash) }));
        this.blocks.push({ hash, number, timestamp, transactions });
        this.blockIndex[hash] = number;
    }

    private newBlockTimestamp() {
        const timestamp = this.nextBlockTimestamp();
        this.timestampSkew = timestamp - systemTimestamp();  // update skew
        return timestamp;
    }

    private toIBlock(block: MockChainBlock): IBlock {
        const txHashes = block.transactions.map(tx => tx.hash);
        return { hash: block.hash, number: block.number, timestamp: block.timestamp, transactions: txHashes };
    }
}

// UTXO implementation
export class MockChainWallet implements IBlockChainWallet {
    static deepCopyWithObjectCreate = true;

    transactionList: MockChainTransaction[] = []
    constructor(public chain: MockChain) {}

    async isMonitoring(): Promise<boolean> {
        throw new Error("Method not implemented.");
    }

    startMonitoringTransactionProgress(): Promise<void> {
        throw new Error("Method not implemented.");
    }
    async stopMonitoring(): Promise<void> {
        throw new Error("Method not implemented.");
    }

    async deleteAccount(from: string, to: string, reference: string | null, options?: TransactionOptionsWithFee | undefined): Promise<number> {
        const value = toBN(await this.getBalance(from));
        const fee = toBN(await this.getTransactionFee());
        const transaction = this.createTransaction(from, to, value.sub(fee), reference, options);
        this.chain.addTransaction(transaction);
        this.transactionList.push(transaction);
        return this.transactionList.length - 1;
    }
    async checkTransactionStatus(txDbId: number): Promise<TransactionInfo> {
        const tx = this.transactionList[txDbId];
        const status = tx.status == TX_SUCCESS ? TransactionStatus.TX_SUCCESS : TransactionStatus.TX_FAILED;
        return { dbId: txDbId, replacedByDdId: null,  transactionHash: tx.hash, status: status };
    }
    async getBalance(address: string): Promise<BN> {
        return this.chain.balances[address] ?? BN_ZERO;
    }
    async getTransactionFee(): Promise<BN> {
        return this.chain.requiredFee;
    }
    addExistingAccount(): Promise<string> {
        throw new Error("Method not implemented.");
    }
    async addTransaction(from: string, to: string, value: BNish, reference: string | null, options?: MockTransactionOptionsWithFee): Promise<number> {
        const transaction = this.createTransaction(from, to, value, reference, options);
        this.chain.addTransaction(transaction);
        this.transactionList.push(transaction);
        return this.transactionList.length - 1;
    }
    async addTransactionAndWaitForItsFinalization(from: string, to: string, value: BNish, reference: string | null, options?: MockTransactionOptionsWithFee): Promise<string> {
        const transaction = this.createTransaction(from, to, value, reference, options);
        this.chain.addTransaction(transaction);
        this.transactionList.push(transaction);
        return transaction.hash;
    }
    async addMultiTransaction(spent: SpentReceivedObject, received: SpentReceivedObject, reference: string | null, options?: MockTransactionOptions): Promise<string> {
        const transaction = this.createMultiTransaction(spent, received, reference, options);
        this.chain.addTransaction(transaction);
        this.transactionList.push(transaction);
        return transaction.hash;
    }
    createTransaction(from: string, to: string, value: BNish, reference: string | null, options?: MockTransactionOptionsWithFee): MockChainTransaction {
        options ??= {};
        value = toBN(value);
        const maxFee = this.calculateMaxFee(options);
        if (maxFee.lt(this.chain.requiredFee)) {
            // mark transaction failed if too little gas/fee is added (like EVM blockchains)
            options = { ...options, status: TX_FAILED };
        }
        const success = options.status == null || options.status === TX_SUCCESS;
        const spent = success ? value.add(maxFee) : maxFee;
        const received = success ? value : BN_ZERO
        const spentObj: SpentReceivedObject = { [from]: [{ value: spent }] };
        const receivedObj: SpentReceivedObject = { [to]: [{ value: received }] };
        return this.createMultiTransaction(spentObj, receivedObj, reference, options);
    }
    createMultiTransaction(spent_: SpentReceivedObject, received_: SpentReceivedObject, reference: string | null, options?: MockTransactionOptions): MockChainTransaction {
        const inputs: TxInputOutput[] = Object.entries(spent_).flatMap(([address, utxos]): TxInputOutput[] => {
            return utxos.map(utxo => [address, toBN(utxo.value)]);
        });
        const outputs: TxInputOutput[] = Object.entries(received_).flatMap(([address, utxos]): TxInputOutput[] => {
            return utxos.map(utxo => [address, toBN(utxo.value)]);
        });
        const totalSpent = inputs.reduce((a, [_, x]) => a.add(x), BN_ZERO);
        const totalReceived = outputs.reduce((a, [_, x]) => a.add(x), BN_ZERO);
        const status = options?.status ?? TX_SUCCESS;
        if (!totalSpent.gte(totalReceived)) fail("mockTransaction: received more than spent");
        if (!totalSpent.gte(totalReceived.add(this.chain.requiredFee))) fail("mockTransaction: not enough fee");
        const hash = this.chain.createTransactionHash(inputs, outputs, reference);
        // hash is set set when transaction is added to a block
        return { hash, inputs, outputs, reference, status };
    }
    async createAccount(): Promise<string> {
        const accountId = Math.floor(Math.random() * 100000) + 1;
        return `UNDERLYING_ACCOUNT_${accountId}`;
    }
    private calculateMaxFee(options: TransactionOptionsWithFee) {
        if (options.maxFee != null) {
            return toBN(options.maxFee);
        } else if (options.gasLimit != null) {
            return toBN(options.gasLimit).mul(toBN(options.gasPrice ?? this.chain.estimatedGasPrice));
        } else {
            return toBN(this.chain.requiredFee);
        }
    }
}
