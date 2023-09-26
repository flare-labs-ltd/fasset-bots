/* eslint-disable @typescript-eslint/no-unused-vars */

import Web3 from "web3";
import coder from "web3-eth-abi";
import { AbiOutput } from "web3-utils";
import { Web3EventDecoder } from "./events/Web3EventDecoder";
import { fail, getOrCreate, preventReentrancy, toBN } from "./helpers";
import { web3DeepNormalize } from "./web3normalize";

export type TransactionWaitFor =
    | { what: 'receipt', timeoutMS?: number }
    | { what: 'nonceIncrease', pollMS: number, timeoutMS?: number }
    | { what: 'confirmations', confirmations: number, timeoutMS?: number };

export interface ContractSettings {
    web3: Web3;
    defaultOptions: TransactionConfig;
    gasMultiplier: number;
    waitFor: TransactionWaitFor;
}

// Hardhat format of compiled contract JSON
export interface ContractJson {
    contractName: string;
    sourceName: string;
    abi: AbiItem[];
    bytecode: string;
    deployedBytecode: string;
    linkReferences: ContractJsonLink;
}

export interface ContractJsonLink {
    [sourceName: string]: {
        [contractName: string]: Array<{
            start: number;
            length: number;
        }>;
    };
}

export class MiniTruffleContractInstance implements Truffle.ContractInstance {
    constructor(
        public _contractFactory: MiniTruffleContract,
        public _settings: ContractSettings,
        public address: string,
        public abi: AbiItem[],
    ) { }

    transactionHash: string = undefined as any;  // typing in typechain is wrong - should be optional

    // following property is not supported (web3 contract leaks memory and we don't need it), so we leave it undefined
    contract = undefined as any;

    allEvents(params?: Truffle.EventOptions): EventEmitter {
        throw new Error("not implemented");
    }

    send(value: Required<TransactionConfig>["value"], txParams?: TransactionConfig): PromiEvent<TransactionReceipt> {
        return this.sendTransaction(txParams ? { ...txParams, value } : { value });
    }

    sendTransaction(transactionConfig: TransactionConfig): PromiEvent<TransactionReceipt> {
        const config = { ...this._settings.defaultOptions, ...transactionConfig, to: this.address };
        return this._settings.web3.eth.sendTransaction(config);
    }

    _withSettings(newSettings: ContractSettings) {
        return new this._contractFactory._instanceConstructor(this._contractFactory, newSettings, this.address);
    }
}

export class MiniTruffleContract implements Truffle.Contract<any> {
    constructor(
        public _settings: ContractSettings,
        public contractName: string,
        public abi: AbiItem[],
        public _contractJson: ContractJson,  // only needed for new
    ) {
        // console.log("Creating contract", contractName);
    }

    address: string = undefined as any;  // typing in typechain is wrong - should be optional

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
        if (bytecode == null || bytecode.length < 4) {    // need at least one byte of bytecode (there is also 0x prefix)
            throw new Error(`Cannot create instance of ${this.contractName}; no code at address ${address}`);
        }
        return new this._instanceConstructor(this, this._settings, address);
    }

    async "new"(...args: any[]): Promise<any> {
        const bytecode = this._contractJson.bytecode;
        if (bytecode == null || bytecode.length < 4) {    // need at least one byte of bytecode (there is also 0x prefix)
            throw new Error(`Contract ${this.contractName} is abstract; cannot deploy`);
        }
        if (bytecode.includes('_')) {
            throw new Error(`Contract ${this.contractName} must be linked before deploy`);
        }
        const web3Contract = new this._settings.web3.eth.Contract(this.abi);
        const constructorAbi = this.abi.find(it => it.type === 'constructor');
        const [methodArgs, config] = splitMethodArgs(constructorAbi, args);
        const data = web3Contract.deploy({ data: bytecode, arguments: formatArguments(methodArgs) }).encodeABI();
        const result = await executeMethodSend(this._settings, { ...config, data: data });
        /* istanbul ignore if */
        if (result.contractAddress == null) {
            throw new Error(`Deploy of contract ${this.contractName} failed`);  // I don't know if this can happen
        }
        const instance = new this._instanceConstructor(this, this._settings, result.contractAddress);
        instance.transactionHash = result.transactionHash;
        this.address = result.contractAddress;
        return instance;
    }

    link(...args: any) {
        if (!(args.length === 1 && args[0] instanceof MiniTruffleContractInstance)) {
            throw new Error(`Only supported variant is '${this.contractName}.link(instance)'`);
        }
        const instance = args[0];
        const { contractName, sourceName } = instance._contractFactory._contractJson;
        const linkRefs = this._contractJson.linkReferences[sourceName][contractName] ?? [];
        for (const { start, length } of linkRefs) {
            this._contractJson.bytecode = this._contractJson.bytecode.slice(0, 2 * start + 2) +
                instance.address.slice(2).toLowerCase() + this._contractJson.bytecode.slice(2 * (start + length) + 2);
        }
    }

    _withSettings(newSettings: ContractSettings) {
        return new MiniTruffleContract(newSettings, this.contractName, this.abi, this._contractJson);
    }
}

export function withSettings<T>(contract: Truffle.Contract<T>, newSettings: ContractSettings): Truffle.Contract<T>;
export function withSettings<T extends Truffle.ContractInstance>(instance: T, newSettings: ContractSettings): T;
export function withSettings(ci: any, newSettings: ContractSettings): any {
    return ci._withSettings(newSettings);
}

interface ContractInstanceConstructor {
    new(contractFactory: MiniTruffleContract, settings: ContractSettings, address: string): MiniTruffleContractInstance;
}

function createContractInstanceConstructor(contractName: string): ContractInstanceConstructor {
    const contractConstructor = class extends MiniTruffleContractInstance {
        constructor(contractFactory: MiniTruffleContract, settings: ContractSettings, address: string) {
            super(contractFactory, settings, address, contractFactory.abi);
            addContractMethods(this, contractFactory.abi);
        }
    }
    Object.defineProperty(contractConstructor, 'name', { value: contractName, writable: false });
    return contractConstructor;
}

function addContractMethods(instance: MiniTruffleContractInstance & { [method: string]: any }, abi: AbiItem[]) {
    instance.methods = {};
    for (const method of groupMethodOverloads(abi).values()) {
        for (const [namesig, item] of method.overloads) {
            const calls = createMethodCalls(instance, item);
            instance.methods[namesig] = calls;
            if (instance[namesig] === undefined) { // do not overwrite predefined methods
                instance[namesig] = calls;
            }
            if (method.overloads.size === 1) {
                instance.methods[method.name] = calls;
                if (instance[method.name] === undefined) { // do not overwrite predefined methods
                    instance[method.name] = calls;
                }
            }
        }
    }
}

interface AbiMethodOverloads {
    name: string;
    overloads: Map<string, AbiItem>;
}

function groupMethodOverloads(abi: AbiItem[]) {
    const namedMethods: Map<string, AbiMethodOverloads> = new Map();
    for (const item of abi) {
        if (item.type !== 'function' || item.name == null) continue;
        const sigtext = createMethodSignatureText(item);
        const namedMethod = getOrCreate(namedMethods, item.name, (name) => ({ name, overloads: new Map() }));
        namedMethod.overloads.set(sigtext, item);
    }
    return namedMethods;
}

function createMethodSignatureText(method: AbiItem) {
    const args = (method.inputs ?? []).map(inp => inp.type).join(',');
    return `${method.name}(${args})`;
}

function createMethodCalls(instance: MiniTruffleContractInstance, method: AbiItem) {
    const callFn = async function (...args: any[]) {
        // console.log(`call ${method.name}`);
        const [methodArgs, config] = splitMethodArgs(method, args);
        const encodedArgs = coder.encodeFunctionCall(method, formatArguments(methodArgs));
        const encResult = await executeMethodCall(instance._settings, { ...config, to: instance.address, data: encodedArgs });
        const outputs = method.outputs ?? [];
        return convertResults(outputs, coder.decodeParameters(outputs, encResult));
    }
    if (isConstant(method)) {
        return callFn;
    }
    // only for mutable functions
    const sendFn = async function (...args: any[]) {
        // console.log(`send ${method.name}`);
        const [methodArgs, config] = splitMethodArgs(method, args);
        const encodedArgs = coder.encodeFunctionCall(method, formatArguments(methodArgs));
        const receipt = await executeMethodSend(instance._settings, { ...config, to: instance.address, data: encodedArgs });
        const logs = instance._contractFactory._eventDecoder.decodeEvents(receipt.logs);
        return { tx: receipt.transactionHash, receipt, logs };
    }
    const estimateGasFn = async function (...args: any[]) {
        // console.log(`estimateGas ${method.name}`);
        const [methodArgs, config] = splitMethodArgs(method, args);
        const encodedArgs = coder.encodeFunctionCall(method, formatArguments(methodArgs));
        return executeMethodEstimateGas(instance._settings, { ...config, to: instance.address, data: encodedArgs });
    }
    sendFn.call = callFn;
    sendFn.sendTransaction = sendFn;
    sendFn.estimateGas = estimateGasFn;
    return sendFn;
}

function isConstant(method: AbiItem) {
    return method.stateMutability === 'pure' || method.stateMutability === 'view';
}

function formatArguments(args: any[]): any[] {
    return web3DeepNormalize(args);
}

function convertResults(abi: AbiOutput[], output: any) {
    if (abi.length === 1) {
        return /^u?int\d+$/.test(abi[0].type) ? toBN(output[0]) : output[0];
    } else {
        const result: any = {};
        for (const [i, outAbi] of abi.entries()) {
            const decVal = /^u?int\d+$/.test(outAbi.type) ? toBN(output[i]) : output[i];
            result[i] = decVal;
            if (outAbi.name) result[outAbi.name] = decVal;
        }
        return result;
    }
}

function splitMethodArgs(method: AbiItem | undefined, args: any[]): [methodArgs: any[], config: TransactionConfig] {
    const paramsLen = method?.inputs?.length ?? 0;
    if (args.length < paramsLen) {
        throw new Error("Not enough arguments");
    }
    if (args.length > paramsLen + 1) {
        throw new Error("Too many arguments");
    }
    return args.length > paramsLen ? [args.slice(0, paramsLen), args[paramsLen]] : [args, {}];
}

async function executeMethodSend(settings: ContractSettings, transactionConfig: TransactionConfig) {
    const { web3, gasMultiplier, waitFor, defaultOptions } = settings;
    const config: TransactionConfig = { ...defaultOptions, ...transactionConfig };
    if (config.gas == null) {
        // estimate gas; should also throw nice errors
        const gas = await web3.eth.estimateGas(config);
        config.gas = gas * gasMultiplier;
    } else {
        // do a call to catch errors without wasting gas for transaction
        await web3.eth.call(config);
    }
    const from = typeof config.from === 'string' ? config.from : fail("'from' field is mandatory");
    const nonce = waitFor.what === 'nonceIncrease' ? await web3.eth.getTransactionCount(from, 'latest') : 0;
    const promiEvent = web3.eth.sendTransaction(config);
    return await waitForFinalization(web3, waitFor, nonce, from, promiEvent);
}

async function executeMethodCall(settings: ContractSettings, transactionConfig: TransactionConfig) {
    const { web3, defaultOptions } = settings;
    const config: TransactionConfig = { ...defaultOptions, ...transactionConfig };
    return await web3.eth.call(config);
}

async function executeMethodEstimateGas(settings: ContractSettings, transactionConfig: TransactionConfig) {
    const { web3, defaultOptions } = settings;
    const config: TransactionConfig = { ...defaultOptions, ...transactionConfig };
    return await web3.eth.estimateGas(config);
}

function waitForFinalization(web3: Web3, waitFor: TransactionWaitFor, initialNonce: number, from: string, promiEvent: PromiEvent<any>): Promise<TransactionReceipt> {
    return new Promise((resolve, reject) => {
        let finished = false;
        let timeout: NodeJS.Timer | number | null = null;
        let noncePollTimer: NodeJS.Timer | number | null = null;
        let receipt: TransactionReceipt | null = null;
        let numberOfConfirmations = -1;
        const cleanupAndExit = (result: TransactionReceipt | null, error: any) => {
            if (finished) return;
            finished = true;
            if (timeout != null) {
                clearTimeout(timeout);
            }
            if (noncePollTimer != null) {
                clearInterval(noncePollTimer);
            }
            (promiEvent as any).off("receipt");
            if (waitFor.what === 'confirmations') {
                (promiEvent as any).off("confirmation");
            }
            if (result) {
                resolve(result);
            } else {
                reject(error ?? new Error("Error when waiting for finalization"));
            }
        }
        const checkFinished = preventReentrancy(async () => {
            let success = false;
            if (waitFor.what === 'receipt') {
                success = receipt != null;
            } else if (waitFor.what === 'confirmations') {
                success = numberOfConfirmations >= waitFor.confirmations;
            } else if (waitFor.what === 'nonceIncrease') { /* istanbul ignore else */
                const nonce = await web3.eth.getTransactionCount(from, 'latest');
                success = nonce > initialNonce;
            }
            if (success && receipt != null) {
                cleanupAndExit(receipt, null);
            }
        });
        // chack for timeout
        if (waitFor.timeoutMS) {
            timeout = setTimeout(() => {
                cleanupAndExit(null, new Error("Timeout waiting for finalization"));
            }, waitFor.timeoutMS);
        }
        // check for errors
        promiEvent.catch((error) => {
            cleanupAndExit(null, error);
        });
        // set receipt when available
        promiEvent.on("receipt", (rec) => {
            receipt = rec;
            checkFinished().catch(ignore);
        }).catch(ignore);
        //
        if (waitFor.what === 'nonceIncrease') {
            /* istanbul ignore next */
            noncePollTimer = setInterval(() => {
                checkFinished().catch(ignore);
            }, waitFor.pollMS);
        } else if (waitFor.what === 'confirmations') {
            promiEvent.on("confirmation", (confNumber) => {
                numberOfConfirmations = confNumber;
                checkFinished().catch(ignore);
            }).catch(ignore);
        }
    });
}

/* istanbul ignore next */
function ignore(error: unknown) {
    // do nothing - the method can be used in promise `.catch()` to prevent
    // uncought error problems (when errors are properly caught elsewhere)
}
