import { WalletClient } from "simple-wallet";
import { toBN, unPrefix0x } from "../utils/helpers";
import { IWalletKeys } from "./WalletKeys";
import { IBlockChainWallet, TransactionOptionsWithFee } from "./interfaces/IBlockChainWallet";

export class BlockchainWalletHelper implements IBlockChainWallet {
    constructor(
        public walletClient: WalletClient,
        private walletKeys: IWalletKeys
    ) {}

    async addTransaction(
        sourceAddress: string,
        targetAddress: string,
        amount: string | number | BN,
        reference: string | null,
        options?: TransactionOptionsWithFee
    ): Promise<string> {
        const value = toBN(amount);
        const fee = undefined;
        const maxFee = options?.maxFee ? toBN(options.maxFee) : undefined;
        const note = reference ? unPrefix0x(reference) : undefined;
        const privateKey = await this.walletKeys.getKey(sourceAddress);
        if (privateKey) {
            const submit = await this.walletClient.executeLockedSignedTransactionAndWait(sourceAddress, privateKey, targetAddress, value, fee, note, maxFee);
            return submit.txId;
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

    async getTransactionFee(): Promise<BN> {
        const fee = await this.walletClient.getCurrentTransactionFee();
        return toBN(fee);
    }
}
