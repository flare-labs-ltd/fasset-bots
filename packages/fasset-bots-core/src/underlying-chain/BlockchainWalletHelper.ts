import { WalletClient } from "@flarelabs/simple-wallet";
import { sleep, toBN, unPrefix0x } from "../utils/helpers";
import { IWalletKeys } from "./WalletKeys";
import { IBlockChainWallet, TransactionOptionsWithFee } from "./interfaces/IBlockChainWallet";
import BN from "bn.js";
import { FeeParams } from "../../../simple-wallet/src/interfaces/WalletTransactionInterface";
import { TransactionStatus } from "../entities/transaction";

export class BlockchainWalletHelper implements IBlockChainWallet {
    constructor(
        public walletClient: WalletClient,
        private walletKeys: IWalletKeys
    ) {}

    addTransactionAndWaitForItsFinalization(sourceAddress: string, targetAddress: string, amount: string | number | BN, reference: string | null, options?: TransactionOptionsWithFee | undefined): Promise<string> {
        throw new Error("Method not implemented.");
    }

    async addTransaction(
        sourceAddress: string,
        targetAddress: string,
        amount: string | number | BN,
        reference: string | null,
        options?: TransactionOptionsWithFee,
        executeUntilBlock?: number //TODO
    ): Promise<number> {
        const value = toBN(amount);
        const fee = undefined;
        const maxFee = options?.maxFee ? toBN(options.maxFee) : undefined;
        const note = reference ? unPrefix0x(reference) : undefined;
        const privateKey = await this.walletKeys.getKey(sourceAddress);
        if (privateKey) {
            const dbId = await this.walletClient.createPaymentTransaction(sourceAddress, privateKey, targetAddress, value, fee, note, maxFee);
            return dbId;
        } else {
            throw new Error(`Cannot find address ${sourceAddress}`);
        }
    }

    async deleteAccount(//TODO-urska - wait for finalization
        sourceAddress: string,
        targetAddress: string,
        reference: string | null,
        options?: TransactionOptionsWithFee
    ): Promise<string> {
        const fee = undefined;
        const maxFee = options?.maxFee ? toBN(options.maxFee) : undefined;
        const note = reference ? unPrefix0x(reference) : undefined;
        const privateKey = await this.walletKeys.getKey(sourceAddress);
        if (privateKey) {
            const dbId = await this.walletClient.createDeleteAccountTransaction(sourceAddress, privateKey, targetAddress, fee, note, maxFee);
            // return dbId;
            return "";
        } else {
            throw new Error(`Cannot find address ${sourceAddress}`);
        }
    }

    async addMultiTransaction(): Promise<string> {
        throw new Error("Method not implemented.");
    }

    async createAccount(): Promise<string> {
        const account = this.walletClient.createWallet();
        await this.walletKeys.addKey(account.address, account.privateKey);
        return account.address;
    }

    async addExistingAccount(address: string, privateKey: string): Promise<string> {
        await this.walletKeys.addKey(address, privateKey);
        return address;
    }

    async getBalance(address: string): Promise<BN> {
        const balance = await this.walletClient.getAccountBalance(address);
        return toBN(balance);
    }

    async getTransactionFee(params: FeeParams): Promise<BN> {
        const fee = await this.walletClient.getCurrentTransactionFee(params);
        return toBN(fee);
    }

}
