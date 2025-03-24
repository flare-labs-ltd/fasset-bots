import { FeeParams, ITransactionMonitor, TransactionInfo } from "@flarelabs/simple-wallet";
import type BN from "bn.js";
import { XRPBlockchainAPI } from "../../../../simple-wallet/src/blockchain-apis/XRPBlockchainAPI";
import { UTXOBlockchainAPI } from "../../../../simple-wallet/src/blockchain-apis/UTXOBlockchainAPI";

type NumberLike = BN | number | string;

export type UTXO = {
    value: NumberLike;
    // ... Add any other properties you want, like txid, vout, etc.
};

export type SpentReceivedObject = {
    [address: string]: UTXO[];
};

export interface TransactionOptionsWithFee {
    // depending on chain, set either maxFee or (gasPrice, gasLimit), but not both
    // if not used, fee/gas limits will be calculated and added automatically by the wallet
    maxFee?: NumberLike; // ignored in simple-wallet when transaction is rbfed - but it makes sure to follow: original amount + original max fee >= rbf amount + rbf fee (to prevent full liquidation in case of rbf)
    maxPaymentForFeeSource?: NumberLike, // ignored in simple-wallet when transaction rbfed
    gasPrice?: NumberLike;
    gasLimit?: NumberLike;
    minFeePerKB?: NumberLike; // in simple-wallet: only used in case of redemption payment; ignored in underlying withdrawal payment
    executeUntilBlock?: NumberLike;
    executeUntilTimestamp?: NumberLike;
    isFreeUnderlying?: boolean; // in simple-wallet: to note free underlying withdrawal, where fee needs to be taken from withdrawal amount
    feeSourceAddress?: string; // in simple-wallet: only used in case of redemption payment (to allow sending higher fee)
}

export interface IBlockChainWallet {
    // Create a transaction with a single source and target address.
    // Amount is the amount received by target and extra fee / gas can be added to it to obtain the value spent from sourceAddress
    // (the added amount can be limited by maxFee).
    // Returns database id of that transaction in simple-wallet.
    addTransaction(
        sourceAddress: string,
        targetAddress: string,
        amount: NumberLike,
        reference: string | null,
        options?: TransactionOptionsWithFee
    ): Promise<number>;

    // Add a generic transaction from a set of source addresses to a set of target addresses.
    // Total source amount may be bigger (but not smaller!) than total target amount, the rest (or part of it) can be used as gas/fee (not all need to be used).
    // This variant is typically used on utxo chains.
    // Returns new transaction hash.
    addMultiTransaction(spend: SpentReceivedObject, received: SpentReceivedObject, reference: string | null): Promise<string>;

    // Creates a new account and returns the address.
    // Private key is kept in the wallet.
    createAccount(): Promise<string>;

    // Add existing account.
    // Private key is kept in the wallet.
    addExistingAccount(address: string, privateKey: string): Promise<string>;

    // Return the balance of an address on the chain. If the address does not exist, returns 0.
    getBalance(address: string, otherAddresses?: string[]): Promise<BN>;

    // Return the current or estimated transaction fee on the chain.
    getTransactionFee(params: FeeParams): Promise<BN>;

    // Delete XRP account or empty funds on UTXO chain.
    // Returns database id of that transaction in simple-wallet.
    deleteAccount(
        sourceAddress: string,
        targetAddress: string,
        reference: string | null,
        options?: TransactionOptionsWithFee
    ): Promise<number>;

    // Adds transaction and waits for transaction to reach finalize status (TX_SUCCESS, TX_FAILED, TX_REPLACED?)
    addTransactionAndWaitForItsFinalization(
        sourceAddress: string,
        targetAddress: string,
        amount: NumberLike,
        reference: string | null,
        options?: TransactionOptionsWithFee
    ): Promise<string>;

    // Waits for transaction to reach finalize status (TX_SUCCESS, TX_FAILED, TX_REPLACED?)
    waitForTransactionFinalization(id: number): Promise<string>;

    // Returns info about transaction (txHash, status, replacedById)
    checkTransactionStatus(txDbId: number): Promise<TransactionInfo>;

    // Background tasks
    createMonitor(): Promise<ITransactionMonitor>;

    monitoringId(): string;

    getBlockChainAPI(): XRPBlockchainAPI | UTXOBlockchainAPI;
}
