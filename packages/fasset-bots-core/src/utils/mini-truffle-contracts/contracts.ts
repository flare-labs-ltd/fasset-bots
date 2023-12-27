import EventEmitter from "events";
import { PromiEvent, TransactionConfig, TransactionReceipt } from "web3-core";
import { AbiItem } from "web3-utils";
import { Truffle } from "../../../typechain-truffle";
import { Web3EventDecoder } from "../events/Web3EventDecoder";
import { replaceStringRange } from "../helpers";
import { createContractInstanceConstructor, executeConstructor } from "./methods";
import { ContractJson, ContractSettings } from "./types";

/**
 * Simple implementation of Truffle.ContractInstance.
 */
export class MiniTruffleContractInstance implements Truffle.ContractInstance {
    constructor(
        public _contractFactory: MiniTruffleContract,
        public _settings: ContractSettings,
        public address: string,
        public abi: AbiItem[]
    ) {}

    transactionHash: string = undefined as any; // typing in typechain is wrong - should be optional

    // following property is not supported (web3 contract leaks memory and we don't need it), so we leave it undefined
    contract = undefined as any;

    /* eslint-disable-next-line @typescript-eslint/no-unused-vars */
    allEvents(params?: Truffle.EventOptions): EventEmitter {
        throw new Error("not implemented");
    }

    send(value: Required<TransactionConfig>["value"], txParams: TransactionConfig = {}): PromiEvent<TransactionReceipt> {
        return this.sendTransaction({ ...txParams, value });
    }

    sendTransaction(transactionConfig: TransactionConfig): PromiEvent<TransactionReceipt> {
        const config = { ...this._settings.defaultTransactionConfig, ...transactionConfig, to: this.address };
        return this._settings.web3.eth.sendTransaction(config);
    }

    /**
     * Create a copy of this instance wrapper with different settings.
     * Allows for e.g. changing finalization method for a certain call.
     */
    _withSettings(newSettings: Partial<ContractSettings>) {
        return new this._contractFactory._instanceConstructor(this._contractFactory, { ...this._settings, ...newSettings }, this.address);
    }
}

/**
 * Simple implementation of Truffle.Contract.
 */
export class MiniTruffleContract implements Truffle.Contract<any> {
    constructor(
        public _settings: ContractSettings,
        public contractName: string,
        public abi: AbiItem[],
        public _bytecode: string | undefined,
        public _contractJson: ContractJson // only needed for linking
    ) {
        // console.log("Creating contract", contractName);
    }

    address: string = undefined as any; // typing in typechain is wrong - should be optional

    _instanceConstructor = createContractInstanceConstructor(this.contractName);

    _eventDecoder = new Web3EventDecoder(this.abi);

    async deployed(): Promise<any> {
        if (!this.address) {
            throw new Error(`Contract ${this.contractName} has not been deployed`);
        }
        return await this.at(this.address);
    }

    async at(address: string): Promise<any> {
        const bytecode = await this._settings.web3.eth.getCode(address);
        if (bytecode == null || bytecode.length < 4) {
            // need at least one byte of bytecode (there is also 0x prefix)
            throw new Error(`Cannot create instance of ${this.contractName}; no code at address ${address}`);
        }
        return new this._instanceConstructor(this, this._settings, address);
    }

    async new(...args: any[]): Promise<any> {
        if (this._bytecode == null || this._bytecode.length < 4) {
            // need at least one byte of bytecode (there is also 0x prefix)
            throw new Error(`Contract ${this.contractName} is abstract; cannot deploy`);
        }
        if (this._bytecode.includes("_")) {
            throw new Error(`Contract ${this.contractName} must be linked before deploy`);
        }
        const result = await executeConstructor(this._settings, this.abi, this._bytecode, args);
        /* istanbul ignore if */
        if (result.contractAddress == null) {
            throw new Error(`Deploy of contract ${this.contractName} failed`); // I don't know if this can happen
        }
        const instance = new this._instanceConstructor(this, this._settings, result.contractAddress);
        instance.transactionHash = result.transactionHash;
        this.address = result.contractAddress;
        return instance;
    }

    link(...args: any) {
        if (this._bytecode == null || this._bytecode.length < 4) {
            throw new Error(`Contract ${this.contractName} is abstract; cannot link`);
        }
        if (!(args.length === 1 && args[0] instanceof MiniTruffleContractInstance)) {
            throw new Error(`Only supported variant is '${this.contractName}.link(instance)'`);
        }
        const instance = args[0];
        const { contractName, sourceName } = instance._contractFactory._contractJson;
        const linkRefs = this._contractJson.linkReferences?.[sourceName]?.[contractName] ?? [];
        for (const { start, length } of linkRefs) {
            this._bytecode = replaceStringRange(this._bytecode, 2 * start + 2, 2 * length, instance.address.slice(2).toLowerCase());
        }
    }

    /**
     * Create a copy of this contract wrapper with different settings.
     * Allows for e.g. changing finalization method for a certain instance.
     */
    _withSettings(newSettings: Partial<ContractSettings>) {
        return new MiniTruffleContract({ ...this._settings, ...newSettings }, this.contractName, this.abi, this._bytecode, this._contractJson);
    }
}

export function withSettings<T extends Truffle.Contract<any>>(contract: T, newSettings: Partial<ContractSettings>): T;
export function withSettings<T extends Truffle.ContractInstance>(instance: T, newSettings: Partial<ContractSettings>): T;
export function withSettings(ci: any, newSettings: Partial<ContractSettings>): any {
    return ci._withSettings(newSettings);
}
