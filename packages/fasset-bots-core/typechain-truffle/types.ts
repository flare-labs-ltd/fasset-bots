import BN from "bn.js";
import { EventEmitter } from "events";
import { PromiEvent, TransactionConfig, TransactionReceipt } from "web3-core";
import { EventOptions as Web3EventOptions } from "web3-eth-contract";
import { AbiItem } from "web3-utils";

/**
 * Namespace
 */
export namespace Truffle {
    export type Accounts = string[];

    export interface TransactionDetails {
        from?: string;
        gas?: BN | number | string;
        gasPrice?: BN | number | string;
        maxPriorityFeePerGas?: BN | number | string;
        maxFeePerGas?: BN | number | string;
        value?: BN | string;
    }

    export interface TransactionLog<EVENTS extends AnyEvent> {
        address: string;
        event: EVENTS["name"];
        args: EVENTS["args"];
        blockHash: string;
        blockNumber: number;
        logIndex: number;
        transactionHash: string;
        transactionIndex: number;
        type: string;
    }

    export interface TransactionResponse<EVENTS extends AnyEvent> {
        tx: string;
        receipt: any;
        logs: TransactionLog<EVENTS>[];
    }

    export interface AnyEvent {
        name: string;
        args: any;
    }

    export interface Contract<T> extends ContractNew<any[]> {
        deployed(): Promise<T>;
        at(address: string): Promise<T>;
        link(name: string, address: string): void;
        link<U>(contract: Contract<U>): void;
        address: string;
        contractName: string;
    }

    export interface EventOptions {
        filter?: Web3EventOptions["filter"];
        fromBlock?: Web3EventOptions["fromBlock"];
        topics?: Web3EventOptions["topics"];
    }

    export interface ContractInstance {
        address: string;
        contract: any;
        transactionHash: string;
        abi: AbiItem[];
        allEvents(params?: EventOptions): EventEmitter;
        send(value: Required<TransactionConfig>["value"], txParams?: TransactionConfig): PromiEvent<TransactionReceipt>;
        sendTransaction(transactionConfig: TransactionConfig): PromiEvent<TransactionReceipt>;
    }

    export interface ContractNew<ARGs extends any[]> {
        "new"(...args: ARGs): any;
    }
}
