import { WALLET } from "simple-wallet/src";
import { PersistenceContext } from "../config/PersistenceContext";
import { SourceId } from "../verification/sources/sources";
import { IBlockChain } from "./interfaces/IBlockChain";
import { IBlockChainWallet, TransactionOptions, TransactionOptionsWithFee } from "./interfaces/IBlockChainWallet";
import { DBWalletKeys } from "./WalletKeys";

export class WalletHelper implements IBlockChainWallet {
    constructor(
        public chain: IBlockChain,
        public chainId: SourceId,
        public wClient: any, // should be defined as WALLET.<chain> aka WALLET.BTC = new WALLET.BTC(connection);
        private pc: PersistenceContext
    ) {
    }

    async addTransaction(sourceAddress: string, targetAddress: string, amount: string | number | import("bn.js"), reference: string | null, options?: TransactionOptionsWithFee): Promise<string> {
        const walletKeys = new DBWalletKeys(this.pc);
        const value = amount as number;
        //TODO add custom fee
        const fee = undefined;
        const note = reference ? reference : undefined;
        const tr = await this.wClient.preparePaymentTransaction(sourceAddress, targetAddress, value, fee, note)
        const privateKey = await walletKeys.getKey(sourceAddress);
        const txSigned = await this.wClient.signTransaction(tr, privateKey);
        const submit = await this.wClient.submitTransaction(txSigned);
        return submit.txId;
    }

    addMultiTransaction(spend: { [address: string]: string | number | import("bn.js"); }, receive: { [address: string]: string | number | import("bn.js"); }, reference: string | null, options?: TransactionOptions): Promise<string> {
        throw new Error("Method not implemented.");
    }

    async createAccount(): Promise<string> {
        const walletKeys = new DBWalletKeys(this.pc);
        const account = await this.wClient.createWallet();
        await walletKeys.addKey(account.address, account.privateKey);
        return account.address;
    }

}