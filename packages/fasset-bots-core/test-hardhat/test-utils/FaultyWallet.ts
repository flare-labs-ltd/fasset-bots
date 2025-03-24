import { ITransactionMonitor, TransactionInfo } from "@flarelabs/simple-wallet";
import { IBlockChainWallet, TransactionOptionsWithFee } from "../../src/underlying-chain/interfaces/IBlockChainWallet";
import { XRPBlockchainAPI } from "../../../simple-wallet/src/blockchain-apis/XRPBlockchainAPI";
import { UTXOBlockchainAPI } from "../../../simple-wallet/src/blockchain-apis/UTXOBlockchainAPI";

export class FaultyWallet implements IBlockChainWallet {
    monitoringId(): string {
        throw new Error("Method not implemented.");
    }
    getBlockChainAPI(): XRPBlockchainAPI | UTXOBlockchainAPI{
        throw new Error("Not implemented");
    }
    async addTransactionAndWaitForItsFinalization(sourceAddress: string, targetAddress: string, amount: string | number | import("bn.js"), reference: string | null, options?: TransactionOptionsWithFee, executeUntilBlock?: number, executeUntilTimestamp?: import("bn.js")): Promise<string> {
        throw new Error("Method not implemented.");
    }
    async waitForTransactionFinalization(id: number): Promise<string> {
        throw new Error("Method not implemented.");
    }
    async checkTransactionStatus(txDbId: number): Promise<TransactionInfo> {
        throw new Error("Method not implemented.");
    }
    async addTransaction(sourceAddress: string, targetAddress: string, amount: string | number | import("bn.js"), reference: string | null, options?: TransactionOptionsWithFee | undefined): Promise<number> {
        throw new Error("Method not implemented.");
    }
    async addTransactionAndWaitForTransactionFinalization(sourceAddress: string, targetAddress: string, amount: string | number | import("bn.js"), reference: string | null, options?: TransactionOptionsWithFee | undefined): Promise<string> {
        throw new Error("Method not implemented.");
    }
    async deleteAccount(sourceAddress: string, targetAddress: string, reference: string | null, options?: TransactionOptionsWithFee | undefined): Promise<any> {
        throw new Error("Method not implemented.");
    }
    async addMultiTransaction(): Promise<string> {
        throw new Error("Method not implemented.");
    }
    async createMonitor(): Promise<ITransactionMonitor> {
        throw new Error("Method not implemented.");
    }
    async createAccount(): Promise<string> {
        return "FaultyUnderlyingAddress";
    }
    async addExistingAccount(address: string, privateKey: string): Promise<string> {
        throw new Error("Method not implemented.");
    }
    async getBalance(address: string): Promise<import("bn.js")> {
        throw new Error("Method not implemented.");
    }
    async getTransactionFee(): Promise<import("bn.js")> {
        throw new Error("Method not implemented.");
    }
}
