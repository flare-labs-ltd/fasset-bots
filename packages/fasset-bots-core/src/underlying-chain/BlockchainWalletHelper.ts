import { FeeParams, IWalletKeys, TransactionInfo, TransactionStatus, WalletClient } from "@flarelabs/simple-wallet";
import { sleep, toBN, unPrefix0x } from "../utils/helpers";
import { IBlockChainWallet, TransactionOptionsWithFee } from "./interfaces/IBlockChainWallet";
import BN from "bn.js";
import { formatArgs, logger } from "../utils";


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
        options?: TransactionOptionsWithFee,
        executeUntilBlock?: number
    ): Promise<number> {
        const value = toBN(amount);
        const fee = undefined;
        const maxFee = options?.maxFee ? toBN(options.maxFee) : undefined;
        const note = reference ? unPrefix0x(reference) : undefined;
        const privateKey = await this.walletKeys.getKey(sourceAddress);
        if (privateKey) {
            const dbId = await this.walletClient.createPaymentTransaction(sourceAddress, privateKey, targetAddress, value, fee, note, maxFee, executeUntilBlock);
            return dbId;
        } else {
            throw new Error(`Cannot find address ${sourceAddress}`);
        }
    }

    async deleteAccount(
        sourceAddress: string,
        targetAddress: string,
        reference: string | null,
        options?: TransactionOptionsWithFee,
    ): Promise<number> {
        const fee = undefined;
        const maxFee = options?.maxFee ? toBN(options.maxFee) : undefined;
        const note = reference ? unPrefix0x(reference) : undefined;
        const privateKey = await this.walletKeys.getKey(sourceAddress);
        if (privateKey) {
            const dbId = await this.walletClient.createDeleteAccountTransaction(sourceAddress, privateKey, targetAddress, fee, note, maxFee);
            return dbId;
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

    async checkTransactionStatus(txDbId: number): Promise<TransactionInfo> {
        return await this.walletClient.getTransactionInfo(txDbId);
    }

    // background task (monitoring in simple-wallet) should be running
    async addTransactionAndWaitForItsFinalization(sourceAddress: string, targetAddress: string, amount: string | number | BN, reference: string | null, options?: TransactionOptionsWithFee | undefined, executeUntilBlock?: number): Promise<string> {
        try {
            void this.startMonitoringTransactionProgress();
            let id = await this.addTransaction(sourceAddress, targetAddress, amount, reference, options, executeUntilBlock);
            logger.info(`Transactions txDbId ${id} was sent: ${sourceAddress}, ${targetAddress}, ${amount.toString()}, ${reference}, ${formatArgs(options)} and ${executeUntilBlock}`);
            let info = await this.checkTransactionStatus(id);
            while (!info.transactionHash ||
                (info.status !== TransactionStatus.TX_SUCCESS && info.status !== TransactionStatus.TX_FAILED))
            {
                await sleep(2000); //sleep for 2 seconds
                info = await this.checkTransactionStatus(id);
                logger.info(`Transactions txDbId ${id} info: ${formatArgs(info)}`);
                if (info.status == TransactionStatus.TX_REPLACED && info.replacedByDdId) {
                    id = info.replacedByDdId;
                    info = await this.checkTransactionStatus(id);
                }
                await this.ensureWalletMonitoringRunning();
            }
            return info.transactionHash;
        } finally {
            await this.stopMonitoring();
        }
    }

    async startMonitoringTransactionProgress(): Promise<void> {
        await this.walletClient.startMonitoringTransactionProgress();
    }

    async stopMonitoring(): Promise<void> {
        return this.walletClient.stopMonitoring();
    }

    async isMonitoring(): Promise<boolean> {
        return this.walletClient.isMonitoring();
    }

    private async ensureWalletMonitoringRunning() {
        const isMonitoring = await this.isMonitoring();
        if (!isMonitoring) {
            void this.startMonitoringTransactionProgress();
        }
    }


}
