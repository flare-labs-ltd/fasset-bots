import { FeeParams, ITransactionMonitor, IWalletKeys, TransactionInfo, TransactionStatus, WalletClient } from "@flarelabs/simple-wallet";
import { requireNotNull, sleep, toBN, unPrefix0x } from "../utils/helpers";
import { IBlockChainWallet, TransactionOptionsWithFee } from "./interfaces/IBlockChainWallet";
import BN from "bn.js";
import { formatArgs, logger } from "../utils";
import { XRPBlockchainAPI } from "../../../simple-wallet/src/blockchain-apis/XRPBlockchainAPI";
import { UTXOBlockchainAPI } from "../../../simple-wallet/src/blockchain-apis/UTXOBlockchainAPI";


export class BlockchainWalletHelper implements IBlockChainWallet {
    constructor(
        public walletClient: WalletClient,
        private walletKeys: IWalletKeys
    ) {}

    requestStopVal: boolean = false;

    monitoringId(): string {
        return this.walletClient.getMonitoringId();
    }

    async addTransaction(
        sourceAddress: string,
        targetAddress: string,
        amount: string | number | BN,
        reference: string | null,
        options?: TransactionOptionsWithFee
    ): Promise<number> {
        const value = toBN(amount);
        const fee = undefined;
        const maxFee = options?.maxFee ? toBN(options.maxFee) : undefined;
        const maxPaymentForFeeSource = options?.maxPaymentForFeeSource ? toBN(options.maxPaymentForFeeSource) : undefined;
        const minFeePerKB = options?.minFeePerKB ? toBN(options.minFeePerKB) : undefined;
        const executeUntilBlock = options?.executeUntilBlock ? toBN(options?.executeUntilBlock).toNumber() : undefined;
        const executeUntilTimestamp = options?.executeUntilTimestamp ? toBN(options?.executeUntilTimestamp) : undefined;
        const note = reference ? unPrefix0x(reference) : undefined;
        const privateKey = await this.walletKeys.getKey(sourceAddress);
        if (privateKey) {
            const dbId = await this.walletClient.createPaymentTransaction(sourceAddress, targetAddress, value, fee, note, maxFee,
                executeUntilBlock, executeUntilTimestamp, options?.isFreeUnderlying, options?.feeSourceAddress, maxPaymentForFeeSource, minFeePerKB);
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
    async waitForTransactionFinalization(id: number, report: (message: string) => void = () => {}): Promise<string> {
        let prevInfo: Partial<TransactionInfo> = {};
        function reportStatusChanges(info: TransactionInfo) {
            if (prevInfo.status !== info.status && info.status != null) {
                report(`Transaction status changed to ${info.status?.toUpperCase()}.`);
            }
            if (prevInfo.dbId !== info.dbId && info.dbId != null) {
                report(`Transaction database id is ${info.dbId}.`);
            }
            if (prevInfo.transactionHash !== info.transactionHash && info.transactionHash != null) {
                report(`Transaction hash is ${info.transactionHash}.`);
            }
            if (prevInfo.replacedByStatus !== info.replacedByStatus && info.replacedByStatus != null) {
                if (prevInfo.replacedByStatus == null) {
                    report("Transaction was stuck and will be replaced.");
                }
                report(`Replacement transaction status changed to ${info.replacedByStatus?.toUpperCase()}.`);
            }
            if (prevInfo.replacedByDdId !== info.replacedByDdId && info.replacedByDdId != null) {
                report(`Replacement transaction database id is ${info.replacedByDdId}.`);
            }
            if (prevInfo.replacedByHash !== info.replacedByHash && info.replacedByHash != null) {
                report(`Replacement transaction hash is ${info.replacedByHash}.`);
            }
            prevInfo = info;
        }
        const monitor = await this.createMonitor();
        try {
            if (await monitor.runningMonitorId() == null) {
                await monitor.startMonitoring();
                report(`Started monitoring for transactions since no external transaction monitor is running. Monitoring id is ${monitor.getId()}.`);
                report(`Please keep the program running at least until the transaction is submitted, preferably until finalization.`);
            }
            logger.info(`Transactions txDbId ${id} is being checked`);
            let info = await this.checkTransactionStatus(id);
            reportStatusChanges(info);
            logger.info(`Transactions txDbId ${id} info: ${formatArgs(info)}`);
            while (!this.requestStopVal && (info.status !== TransactionStatus.TX_SUCCESS && info.status !== TransactionStatus.TX_FAILED))
            {
                await sleep(5000); //sleep for 5 seconds
                if (info.status === TransactionStatus.TX_REPLACED && info.replacedByDdId) {
                    const replacedId = info.replacedByDdId;
                    logger.info(`Replacement transaction txDbId ${replacedId}`);
                    if (info.replacedByStatus === TransactionStatus.TX_SUCCESS) {
                        logger.info(`Replacement transaction ${replacedId} succeeded.`);
                        return requireNotNull(info.replacedByHash);
                    } else if (info.replacedByStatus === TransactionStatus.TX_FAILED) {
                        logger.warn(`Replacement transaction ${replacedId} failed.`);
                        await sleep(10000);
                        info = await this.checkTransactionStatus(id);
                        reportStatusChanges(info);
                        if (info.status === TransactionStatus.TX_SUCCESS) {
                            return requireNotNull(info.transactionHash);
                        } else {
                            logger.warn(`Original transaction ${id} is still not successful. Exiting the loop.`);
                            break;
                        }
                    }
                }
                info = await this.checkTransactionStatus(id);
                reportStatusChanges(info);
                logger.info(`Transactions txDbId ${id} info: ${formatArgs(info)}`);
                const monitorStarted = await this.ensureWalletMonitoringRunning(monitor);
                if (monitorStarted) {
                    report(`Started monitoring for transactions since external transaction monitor has stopped. Monitoring id is ${monitor.getId()}.`);
                    report(`Please keep the program running at least until the transaction is submitted, preferably until finalization.`);
                }
                if (this.requestStopVal) {
                    if (monitor.isMonitoring()) {
                        logger.warn(`Transaction monitoring ${this.monitoringId()} was stopped due to termination signal.`);
                        console.warn(`Transaction monitoring ${this.monitoringId()} was stopped due to termination signal.`);
                    }
                    break;
                }
            }
            if (!info.transactionHash) {
                logger.error(`Cannot obtain transaction hash for id ${id}`);
                throw new Error(`Cannot obtain transaction hash for id ${id}`);
            }
            return info.transactionHash;
        } finally {
            await monitor.stopMonitoring();
        }
    }

    async addTransactionAndWaitForItsFinalization(
        sourceAddress: string,
        targetAddress: string,
        amount: string | number | BN,
        reference: string | null,
        options?: TransactionOptionsWithFee
    ): Promise<string> {
        const id = await this.addTransaction(sourceAddress, targetAddress, amount, reference, options);
        const hash = await this.waitForTransactionFinalization(id);
        return hash;
    }

    async createMonitor() {
        return await this.walletClient.createMonitor();
    }

    async requestStop(): Promise<void> {
        this.requestStopVal = true;
    }

    getBlockChainAPI(): XRPBlockchainAPI | UTXOBlockchainAPI {
        return this.walletClient.getBlockChainAPI();
    }
    /* istanbul ignore next */
    private async ensureWalletMonitoringRunning(monitor: ITransactionMonitor) {
        const someMonitorRunning = await monitor.runningMonitorId() != null;
        if (!someMonitorRunning) {
            await monitor.startMonitoring();
            return true;
        }
        return false;
    }
}
