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

    requestStopVal: boolean = false;

    async addTransaction(
        sourceAddress: string,
        targetAddress: string,
        amount: string | number | BN,
        reference: string | null,
        options?: TransactionOptionsWithFee,
        executeUntilBlock?: number,
        executeUntilTimestamp?: BN
    ): Promise<number> {
        const value = toBN(amount);
        const fee = undefined;
        const maxFee = options?.maxFee ? toBN(options.maxFee) : undefined;
        const note = reference ? unPrefix0x(reference) : undefined;
        const privateKey = await this.walletKeys.getKey(sourceAddress);
        if (privateKey) {
            const dbId = await this.walletClient.createPaymentTransaction(sourceAddress, targetAddress, value, fee, note, maxFee, executeUntilBlock, executeUntilTimestamp);
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
            const dbId = await this.walletClient.createDeleteAccountTransaction(sourceAddress, targetAddress, fee, note, maxFee);
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

    async getBalance(address: string, otherAddresses?: string[]): Promise<BN> {
        const balance = await this.walletClient.getAccountBalance(address, otherAddresses);
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
    /* istanbul ignore next */
    async waitForTransactionFinalization(id: number): Promise<string> {
        try {
            void this.startMonitoringTransactionProgress().catch((error) => {
                logger.error(`Background task to monitor wallet ended unexpectedly:`, error);
                console.error(`Background task to monitor wallet ended unexpectedly:`, error);
            });
            logger.info(`Transactions txDbId ${id} is being checked`);
            let info = await this.checkTransactionStatus(id);

            while (!this.requestStopVal && (info.status !== TransactionStatus.TX_SUCCESS && info.status !== TransactionStatus.TX_FAILED))
            {
                await sleep(5000); //sleep for 5 seconds
                logger.info(`Transactions txDbId ${id} info: ${formatArgs(info)}`);
                if (info.status === TransactionStatus.TX_REPLACED && info.replacedByDdId) {
                    const replacedId = info.replacedByDdId;
                    logger.info(`Replacement transaction txDbId ${replacedId}`);
                    if (info.replacedByStatus === TransactionStatus.TX_SUCCESS) {
                        logger.info(`Replacement transaction ${replacedId} succeeded.`);
                        return info.replacedByHash!;
                    } else if (info.replacedByStatus === TransactionStatus.TX_FAILED) {
                        logger.warn(`Replacement transaction ${replacedId} failed.`);
                        await sleep(10000);
                        info = await this.checkTransactionStatus(id);
                        if (info.status === TransactionStatus.TX_SUCCESS) {
                            return info.transactionHash!;
                        } else {
                            logger.warn(`Original transaction ${id} is still not successful. Exiting the loop.`);
                            break;
                        }
                    }
                }
                info = await this.checkTransactionStatus(id);
                await this.ensureWalletMonitoringRunning();
                if (this.requestStopVal) {
                    logger.warn(`Transaction monitoring was stopped due to termination signal.`);
                    console.warn(`Transaction monitoring was stopped due to termination signal.`);
                    break;
                }
            }
            if (!info.transactionHash) {
                logger.error(`Cannot obtain transaction hash for id ${id}`);
                throw new Error(`Cannot obtain transaction hash for id ${id}`);
            }
            return info.transactionHash;
        } finally {
            await this.stopMonitoring();
        }
    }

    async addTransactionAndWaitForItsFinalization(sourceAddress: string, targetAddress: string, amount: string | number | BN, reference: string | null, options?: TransactionOptionsWithFee | undefined, executeUntilBlock?: number, executeUntilTimestamp?: BN): Promise<string> {
        const id = await this.addTransaction(sourceAddress, targetAddress, amount, reference, options, executeUntilBlock, executeUntilTimestamp);
        const hash = await this.waitForTransactionFinalization(id);
        return hash;
    }

    async startMonitoringTransactionProgress(): Promise<void> {
        await this.walletClient.startMonitoringTransactionProgress();
    }

    async requestStop(): Promise<void> {
        this.requestStopVal = true;
    }

    async stopMonitoring(): Promise<void> {
        return this.walletClient.stopMonitoring();
    }

    async isMonitoring(): Promise<boolean> {
        return this.walletClient.isMonitoring();
    }
    /* istanbul ignore next */
    private async ensureWalletMonitoringRunning() {
        const isMonitoring = await this.isMonitoring();
        if (!isMonitoring) {
            void this.startMonitoringTransactionProgress().catch((error) => {
                logger.error(`Background task to monitor wallet ended unexpectedly:`, error);
                console.error(`Background task to monitor wallet ended unexpectedly:`, error);
            });
        }
    }
}