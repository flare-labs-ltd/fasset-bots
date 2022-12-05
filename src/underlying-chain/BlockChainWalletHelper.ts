import { EntityManager } from "@mikro-orm/core";
import { WalletClient } from "simple-wallet";
import { IBlockChain } from "./interfaces/IBlockChain";
import { IBlockChainWallet, TransactionOptions, TransactionOptionsWithFee } from "./interfaces/IBlockChainWallet";
import { DBWalletKeys } from "./WalletKeys";

export class BlockChainWalletHelper implements IBlockChainWallet {
    constructor(
        public walletClient: WalletClient,
        private em: EntityManager,
        public chain: IBlockChain
    ) {}

    async addTransaction(sourceAddress: string, targetAddress: string, amount: string | number | BN, reference: string | null, options?: TransactionOptionsWithFee, awaitForTransaction?: boolean): Promise<string> {
        const walletKeys = new DBWalletKeys(this.em);
        const value = amount as number;
        const fee = undefined;
        const maxFee = options?.maxFee ? Number(options.maxFee) : undefined;
        const note = reference ? reference : undefined;
        const tr = await this.walletClient.preparePaymentTransaction(sourceAddress, targetAddress, value, fee, note, maxFee);
        const privateKey = await walletKeys.getKey(sourceAddress);
        if (privateKey) {
            const txSigned = await this.walletClient.signTransaction(tr, privateKey);
            const submit = awaitForTransaction ? await this.walletClient.submitTransactionAndWait(txSigned) : await this.walletClient.submitTransaction(txSigned);
            return submit.txId;
        } else {
            throw new Error(`Cannot find address ${sourceAddress}`);
        }
    }

    addMultiTransaction(spend: { [address: string]: string | number | BN; }, receive: { [address: string]: string | number | BN; }, reference: string | null, options?: TransactionOptions): Promise<string> {
        throw new Error("Method not implemented.");
    }

    async createAccount(): Promise<string> {
        const walletKeys = new DBWalletKeys(this.em);
        const account = this.walletClient.createWallet();
        await walletKeys.addKey(account.address, account.privateKey);
        return account.address;
    }

    async addExistingAccount(address: string, privateKey: string): Promise<string> {
        const walletKeys = new DBWalletKeys(this.em);
        await walletKeys.addKey(address, privateKey);
        return address;
    }
}
