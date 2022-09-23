import { PersistenceContext } from "../config/PersistenceContext";
import { IBlockChain } from "./interfaces/IBlockChain";
import { IBlockChainWallet, TransactionOptions, TransactionOptionsWithFee } from "./interfaces/IBlockChainWallet";
import { DBWalletKeys } from "./WalletKeys";
import { WalletClient } from "simple-wallet";

export class BlockChainWalletHelper implements IBlockChainWallet {
    constructor(
        public walletClient: WalletClient,
        private pc: PersistenceContext,
        public chain: IBlockChain
    ) {}

    async addTransaction(sourceAddress: string, targetAddress: string, amount: string | number | BN, reference: string | null, options?: TransactionOptionsWithFee, awaitForTransaction?: boolean): Promise<string> {
        const walletKeys = new DBWalletKeys(this.pc);
        const value = amount as number;
        //TODO add custom fee
        const fee = undefined;
        const note = reference ? reference : undefined;
        const tr = await this.walletClient.preparePaymentTransaction(sourceAddress, targetAddress, value, fee, note);
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
        const walletKeys = new DBWalletKeys(this.pc);
        const account = this.walletClient.createWallet();
        await walletKeys.addKey(account.address, account.privateKey);
        return account.address;
    }

}
