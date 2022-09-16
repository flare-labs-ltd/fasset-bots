import { WALLET } from "simple-wallet/src";
import { PersistenceContext } from "../config/PersistenceContext";
import { SourceId } from "../verification/sources/sources";
import { IBlockChain } from "./interfaces/IBlockChain";
import { IBlockChainWallet, TransactionOptions, TransactionOptionsWithFee } from "./interfaces/IBlockChainWallet";
import { DBWalletKeys } from "./WalletKeys";

export class WalletHelper implements IBlockChainWallet {
    constructor(
        public chain: IBlockChain,
        public wallet: IBlockChainWallet,
        public chainId: SourceId,
        public wClient: any,
        private pc: PersistenceContext
    ) {
        if(chainId === SourceId.ALGO) this.wClient = WALLET.ALGO;
        else if(chainId === SourceId.BTC) this.wClient = WALLET.BTC;
        else if(chainId === SourceId.DOGE) this.wClient = WALLET.DOGE;
        else if(chainId === SourceId.LTC) this.wClient = WALLET.LTC;
        else if(chainId === SourceId.XRP) this.wClient = WALLET.XRP;
        else this.wClient = null;
    }

    async addTransaction(sourceAddress: string, targetAddress: string, amount: string | number | import("bn.js"), reference: string | null, options?: TransactionOptionsWithFee): Promise<string> {
        const walletKeys = new DBWalletKeys(this.pc);
        const value = amount as number;
        const fee = undefined;
        const note = reference ? reference : undefined;
        const tr = await this.wClient.preparePaymentTransaction(sourceAddress, targetAddress, value, fee, note)
        const privateKey = await walletKeys.getKey(sourceAddress);
        const txSigned = await this.wClient.signTransaction(tr, privateKey);
        const submit = await this.wClient.submitTransaction(txSigned);
        return submit.result.tx_blob;
    }

    addMultiTransaction(spend: { [address: string]: string | number | import("bn.js"); }, receive: { [address: string]: string | number | import("bn.js"); }, reference: string | null, options?: TransactionOptions): Promise<string> {
        throw new Error("Method not implemented.");
    }

    async createAccount(): Promise<string> {
        const walletKeys = new DBWalletKeys(this.pc);
        const account = await this.wClient.createWallet();
        walletKeys.addKey(account.address, account.privateKey);
        return account.address;
    }

}