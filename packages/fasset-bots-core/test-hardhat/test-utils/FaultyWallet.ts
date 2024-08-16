import { TransactionInfo } from "@flarelabs/simple-wallet";
import { IBlockChainWallet, TransactionOptionsWithFee } from "../../src/underlying-chain/interfaces/IBlockChainWallet";

export class FaultyWallet implements IBlockChainWallet {
    isMonitoring(): boolean {
        throw new Error("Method not implemented.");
    }
    startMonitoringTransactionProgress(): Promise<void> {
        throw new Error("Method not implemented.");
    }
    stopMonitoring(): void {
        throw new Error("Method not implemented.");
    }
    checkTransactionStatus(txDbId: number): Promise<TransactionInfo> {
        throw new Error("Method not implemented.");
    }
    addTransaction(sourceAddress: string, targetAddress: string, amount: string | number | import("bn.js"), reference: string | null, options?: TransactionOptionsWithFee | undefined): Promise<number> {
        throw new Error("Method not implemented.");
    }
    addTransactionAndWaitForItsFinalization(sourceAddress: string, targetAddress: string, amount: string | number | import("bn.js"), reference: string | null, options?: TransactionOptionsWithFee | undefined): Promise<string> {
        throw new Error("Method not implemented.");
    }
    deleteAccount(sourceAddress: string, targetAddress: string, reference: string | null, options?: TransactionOptionsWithFee | undefined): Promise<any> {
        throw new Error("Method not implemented.");
    }
    addMultiTransaction(): Promise<string> {
        throw new Error("Method not implemented.");
    }
    async createAccount(): Promise<string> {
        return "FaultyUnderlyingAddress";
    }
    addExistingAccount(address: string, privateKey: string): Promise<string> {
        throw new Error("Method not implemented.");
    }
    getBalance(address: string): Promise<import("bn.js")> {
        throw new Error("Method not implemented.");
    }
    getTransactionFee(): Promise<import("bn.js")> {
        throw new Error("Method not implemented.");
    }
}
