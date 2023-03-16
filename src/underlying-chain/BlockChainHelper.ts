import { MCC, MccClient } from "@flarenetwork/mcc";
import { IBlock, IBlockChain, IBlockId, ITransaction, TxInputOutput } from "./interfaces/IBlockChain";

export class BlockChainHelper implements IBlockChain {
    constructor(
        public mccClient: MccClient
    ) { }

    finalizationBlocks: number = 0;
    secondsPerBlock: number = 0;

    async getTransaction(txHash: string): Promise<ITransaction | null> {
        try {
            if (this.mccClient instanceof MCC.ALGO) {
                const transaction = (await this.mccClient.getIndexerTransaction(txHash))!; //indexer is set, otherwise it fails on set up
                const inputs: TxInputOutput[] = [];
                const outputs: TxInputOutput[] = [];
                for (const input of transaction.spentAmounts) {
                    inputs.push([input.address!, input.amount]);
                }
                for (const output of transaction.receivedAmounts) {
                    outputs.push([output.address!, output.amount]);
                }
                return {
                    hash: transaction.hash,
                    inputs: inputs,
                    outputs: outputs,
                    reference: transaction.stdPaymentReference,
                    status: transaction.successStatus
                };
            } else {
                const transaction = await this.mccClient.getTransaction(txHash);
                const inputs: TxInputOutput[] = [];
                const outputs: TxInputOutput[] = [];
                for (const input of transaction.spentAmounts) {
                    inputs.push([input.address ? input.address : "", input.amount]);
                }
                for (const output of transaction.receivedAmounts) {
                    outputs.push([output.address ? output.address : "", output.amount]);
                }
                return {
                    hash: transaction.txid,
                    inputs: inputs,
                    outputs: outputs,
                    reference: transaction.stdPaymentReference,
                    status: transaction.successStatus
                };
            }
        } catch (error) {
            console.error(`Transaction with hash ${txHash} not found.`);
            return null;
        }
    }

    async getTransactionBlock(): Promise<IBlockId | null> {
        throw new Error("Method not implemented on chain. Use indexer.");
    }

    async getBalance(): Promise<BN> {
        throw new Error("Method not implemented on chain. Use wallet.");
    }

    async getBlock(blockHash: string): Promise<IBlock | null> {
        if (this.mccClient instanceof MCC.ALGO) {
            throw new Error("Method not implemented in ALGO.");
        } else {
            try {
                const block = await this.mccClient.getBlock(blockHash);
                return {
                    hash: block.blockHash,
                    number: block.number,
                    timestamp: block.unixTimestamp,
                    transactions: block.transactionIds
                };
            } catch (error) {
                console.error(`Block with hash ${blockHash} not found.`);
                return null;
            }
        }
    }

    async getBlockAt(blockNumber: number): Promise<IBlock | null> {
        let block = null;
        let hash = "";
        try {
            if (this.mccClient instanceof MCC.ALGO) {
                block = await this.mccClient.getBlock(blockNumber);
                hash = block.blockHashBase32;
            } else {
                block = await this.mccClient.getBlock(blockNumber);
                hash = block.blockHash;
            }
            return {
                hash: hash,
                number: block.number,
                timestamp: block.unixTimestamp,
                transactions: block.transactionIds
            }
        } catch (error) {
            console.error(`Block with number ${blockNumber} not found.`);
            return null;
        }
    }

    async getBlockHeight(): Promise<number> {
        return await this.mccClient.getBlockHeight();
    }

}
