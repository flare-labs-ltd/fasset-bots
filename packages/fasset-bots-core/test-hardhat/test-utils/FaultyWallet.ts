import { IBlockChainWallet, TransactionOptionsWithFee } from "../../src/underlying-chain/interfaces/IBlockChainWallet";

export class FaultyWallet implements IBlockChainWallet {
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
