import { MCC, MccClient } from "@flarenetwork/mcc/src";
import { IBlock, IBlockChain, IBlockId, ITransaction, TxInputOutput } from "./interfaces/IBlockChain";
import { WalletClient } from "simple-wallet/src/types";
import { toBN } from "../utils/helpers";

export class BlockChainHelper implements IBlockChain {
    constructor(
        public walletClient: WalletClient,
        public mccClient: MccClient,
    ) { }

    finalizationBlocks: number = 0;
    secondsPerBlock: number = 0;

    async getTransaction(txHash: string): Promise<ITransaction | null> {
        let transaction = null;
        if (this.mccClient instanceof MCC.ALGO) {
            transaction = await this.mccClient.getIndexerTransaction(txHash);
            if (transaction) {
                const inputs: TxInputOutput[] = [];
                const outputs: TxInputOutput[] = [];
                for (let input of transaction.spentAmounts) {
                    inputs.push([input.address ? input.address : "", input.amount]);
                }
                for (let output of transaction.spentAmounts) {
                    outputs.push([output.address ? output.address : "", output.amount]);
                }
                return {
                    hash: transaction.hash,
                    inputs: inputs,
                    outputs: outputs,
                    reference: transaction.stdPaymentReference,
                    status: transaction.successStatus
                };
            }
        } else {
            transaction = await this.mccClient.getTransaction(txHash);
            if (transaction) {
                const inputs: TxInputOutput[] = [];
                const outputs: TxInputOutput[] = [];
                for (let input of transaction.spentAmounts) {
                    inputs.push([input.address ? input.address : "", input.amount]);
                }
                for (let output of transaction.spentAmounts) {
                    outputs.push([output.address ? output.address : "", output.amount]);
                }
                return {
                    hash: transaction.hash,
                    inputs: inputs,
                    outputs: outputs,
                    reference: transaction.stdPaymentReference,
                    status: transaction.successStatus
                };
            }
        }
        return transaction;
    }

    async getTransactionBlock(txHash: string): Promise<IBlockId | null> {
        throw new Error("Method not implemented.");
    }

    async getBalance(address: string): Promise<import("bn.js")> {
        const balance = await this.walletClient.getAccountBalance(address);
        return toBN(balance);
    }

    async getBlock(blockHash: string): Promise<IBlock | null> {
        if (this.mccClient instanceof MCC.ALGO) {
            throw new Error("Method not implemented in ALGO.");
        } else {
            const block = await this.mccClient.getBlock(blockHash);
            return {
                hash: block.blockHash,
                number: block.number,
                timestamp: block.unixTimestamp,
                transactions: block.transactionIds
            };
        }
    }

    async getBlockAt(blockNumber: number): Promise<IBlock | null> {
        const block = await this.mccClient.getBlock(blockNumber);
        return {
            hash: block.blockHash,
            number: block.number,
            timestamp: block.unixTimestamp,
            transactions: block.transactionIds
        };
    }

    async getBlockHeight(): Promise<number> {
        return await this.mccClient.getBlockHeight();
    }
}