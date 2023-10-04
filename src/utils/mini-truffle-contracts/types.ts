import Web3 from "web3";
import { TransactionConfig } from "web3-core";
import { AbiItem } from "web3-utils";

/**
 * Possible finalization methods.
 */
export type TransactionWaitFor =
    | { what: 'receipt'; timeoutMS?: number; }
    | { what: 'nonceIncrease'; pollMS: number; timeoutMS?: number; }
    | { what: 'confirmations'; confirmations: number; timeoutMS?: number; };

/**
 * Settings that affect the calls of contract methods through mini truffle.
 */
export interface ContractSettings {
    /**
     * The `Web3` instance through which to interact with network.
     */
    web3: Web3;

    /**
     * Default transaction config. Will be overriden by the transaction config provided in each call.
     */
    defaultTransactionConfig: TransactionConfig;

    /**
     * The amount of gas to use in sendTransaction. If set to 'auto', it will be calculated as `estimateGas() * gasMultiplier`.
     */
    gas: number | 'auto';

    /**
     * The number that the result of `estimateGas()` is multiplied with for limiting the gas in send transaction.
     */
    gasMultiplier: number;

    /**
     * Default account address from which the transactions are sent in the absence of `from` field.
     */
    defaultAccount: string | null;

    /**
     * Default transaction finalization settings.
     */
    waitFor: TransactionWaitFor;
}


/**
 * Hardhat format of compiled contract JSON.
 */
export interface ContractJson {
    contractName: string;
    sourceName: string;
    abi: AbiItem[];
    bytecode?: string;
    deployedBytecode?: string;
    linkReferences?: ContractJsonLink;
}

export interface ContractJsonLink {
    [sourceName: string]: {
        [contractName: string]: Array<{
            start: number;
            length: number;
        }>;
    };
}
