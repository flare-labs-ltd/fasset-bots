import { EntityManager } from "@mikro-orm/core";
import { WalletClient } from "simple-wallet";
import { toBN } from "../utils/helpers";
import { IBlockChainWallet, TransactionOptionsWithFee } from "./interfaces/IBlockChainWallet";
import { DBWalletKeys } from "./WalletKeys";
import { unPrefix0x } from "../verification/attestation-types/attestation-types-utils";

export class BlockchainWalletHelper implements IBlockChainWallet {
    constructor(
        public walletClient: WalletClient,
        private em: EntityManager,
    ) { }

    async addTransaction(sourceAddress: string, targetAddress: string, amount: string | number | BN, reference: string | null, options?: TransactionOptionsWithFee, awaitForTransaction?: boolean): Promise<string> {
        const walletKeys = new DBWalletKeys(this.em);
        const value = amount as number;
        const fee = undefined;
        const maxFee = options?.maxFee ? Number(options.maxFee) : undefined;
        const note = reference ? unPrefix0x(reference) : undefined;
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

    async addMultiTransaction(): Promise<string> {
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


    async getBalance(address: string): Promise<BN> {
        const balance = await this.walletClient.getAccountBalance(address);
        return toBN(balance);
    }

    async getTransactionFee(): Promise<BN> {
        const fee = await this.walletClient.getCurrentTransactionFee();
        return toBN(fee);
    }
}