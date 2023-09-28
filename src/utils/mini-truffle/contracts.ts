/* eslint-disable @typescript-eslint/no-unused-vars */

import Web3 from "web3";
import coder from "web3-eth-abi";
import { AbiOutput } from "web3-utils";
import { Web3EventDecoder } from "../events/Web3EventDecoder";
import { getOrCreate, preventReentrancy, replaceStringRange, sleep, toBN } from "../helpers";
import { web3DeepNormalize } from "../web3normalize";

export type TransactionWaitFor =
    | { what: 'receipt', timeoutMS?: number }
    | { what: 'nonceIncrease', pollMS: number, timeoutMS?: number }
    | { what: 'confirmations', confirmations: number, timeoutMS?: number };

export interface ContractSettings {
    web3: Web3;
    defaultOptions: TransactionConfig;
    gasMultiplier: number;
    waitFor: TransactionWaitFor;
    defaultAccount: string | null;
}

// Hardhat format of compiled contract JSON
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

    send(value: Required<TransactionConfig>["value"], txParams: TransactionConfig = {}): PromiEvent<TransactionReceipt> {
        return this.sendTransaction({ ...txParams, value });
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
        public _bytecode: string | undefined,
        public _contractJson: ContractJson,     // only needed for linking
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
        if (this._bytecode == null || this._bytecode.length < 4) {    // need at least one byte of bytecode (there is also 0x prefix)
            throw new Error(`Contract ${this.contractName} is abstract; cannot deploy`);
        }
        if (this._bytecode.includes('_')) {
            throw new Error(`Contract ${this.contractName} must be linked before deploy`);
        }
        const web3Contract = new this._settings.web3.eth.Contract(this.abi);
        const constructorAbi = this.abi.find(it => it.type === 'constructor');
        const [methodArgs, config] = splitMethodArgs(constructorAbi, args);
        const data = web3Contract.deploy({ data: this._bytecode, arguments: formatArguments(methodArgs) }).encodeABI();
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

    _withSettings(newSettings: ContractSettings) {
        return new MiniTruffleContract(newSettings, this.contractName, this.abi, this._bytecode, this._contractJson);
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
        for (const [nameWithSignature, item] of method.overloads) {
            const calls = createMethodCalls(instance, item);
            instance.methods[nameWithSignature] = calls;
            instance[nameWithSignature] = calls;
            if (method.overloads.size === 1) {
                instance.methods[method.name] = calls;
                if (!(method.name in instance)) { // do not overwrite predefined methods
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
        const nameWithSignature = createMethodNameWithSignature(item);
        const namedMethod = getOrCreate(namedMethods, item.name, (name) => ({ name, overloads: new Map() }));
        namedMethod.overloads.set(nameWithSignature, item);
    }
    return namedMethods;
}

function createMethodNameWithSignature(method: AbiItem) {
    /* istanbul ignore next: method.inputs cannot really be undefined - web3 contract fails if it is */
    const args = (method.inputs ?? []).map(inp => inp.type).join(',');
    return `${method.name}(${args})`;
}

function createMethodCalls(instance: MiniTruffleContractInstance, method: AbiItem) {
    const callFn = async function (...args: any[]) {
        // console.log(`call ${method.name}`);
        const [methodArgs, config] = splitMethodArgs(method, args);
        const encodedArgs = coder.encodeFunctionCall(method, formatArguments(methodArgs));
        const encResult = await executeMethodCall(instance._settings, { ...config, to: instance.address, data: encodedArgs });
        /* istanbul ignore next: method.outputs cannot really be undefined - web3 contract fails if it is */
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
        return decodeArgument(abi[0], output[0]);
    } else {
        const result: any = {};
        for (const [i, abiItem] of abi.entries()) {
            result[i] = decodeArgument(abiItem, output[i]);
            /* istanbul ignore else */
            if (abiItem.name) {
                result[abiItem.name] = result[i];
            }
        }
        return result;
    }
}

function decodeArgument(abiItem: AbiOutput, value: any) {
    return /^u?int\d+$/.test(abiItem.type) ? toBN(value) : value;
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
    const { web3, gasMultiplier, waitFor } = settings;
    const config = mergeConfig(settings, transactionConfig);
    if (config.gas == null) {
        // estimate gas; should also throw nice errors
        const gas = await web3.eth.estimateGas(config);
        config.gas = gas * gasMultiplier;
    } else {
        // do a call to catch errors without wasting gas for transaction
        await web3.eth.call(config);
    }
    const nonce = waitFor.what === 'nonceIncrease' ? await web3.eth.getTransactionCount(config.from, 'latest') : 0;
    const promiEvent = web3.eth.sendTransaction(config);
    return await waitForFinalization(web3, waitFor, nonce, config.from, promiEvent);
}

async function executeMethodCall(settings: ContractSettings, transactionConfig: TransactionConfig) {
    const config = mergeConfig(settings, transactionConfig);
    return await settings.web3.eth.call(config);
}

async function executeMethodEstimateGas(settings: ContractSettings, transactionConfig: TransactionConfig) {
    const config = mergeConfig(settings, transactionConfig);
    return await settings.web3.eth.estimateGas(config);
}

export class PromiseCancelled extends Error {
    constructor(message = "Promise cancelled") {
        super(message);
    }
}

type TransactionConfigWithFrom = TransactionConfig & { from: string; };

function mergeConfig(settings: ContractSettings, transactionConfig: TransactionConfig): TransactionConfigWithFrom {
    const config: TransactionConfig = { ...settings.defaultOptions, ...transactionConfig };
    if (config.from == null && settings.defaultAccount != null) {
        config.from = settings.defaultAccount;
    }
    if (typeof config.from !== 'string') {
        throw new Error("'from' field is mandatory");
    }
    return config as TransactionConfigWithFrom;
}

async function waitForFinalization(web3: Web3, waitFor: TransactionWaitFor, initialNonce: number, from: string, promiEvent: PromiEvent<TransactionReceipt>): Promise<TransactionReceipt> {
    if (waitFor.timeoutMS) {
        const result = await Promise.race([
            waitForFinalizationInner(web3, waitFor, initialNonce, from, promiEvent),
            sleep(waitFor.timeoutMS).then(() => {
                console.log("Timer expired");
                return Promise.reject(new Error("Timeout waiting for finalization"));
            })
        ]);
        return result;
    } else {
        return waitForFinalizationInner(web3, waitFor, initialNonce, from, promiEvent);
    }
}

async function waitForFinalizationInner(web3: Web3, waitFor: TransactionWaitFor, initialNonce: number, from: string, promiEvent: PromiEvent<TransactionReceipt>): Promise<TransactionReceipt> {
    const waitConf = waitFor.what === 'confirmations' ? waitConfirmations(promiEvent, waitFor.confirmations) : null;
    const receipt = await promiEvent;
    if (waitFor.what === 'receipt') {
        return receipt;
    } else if (waitFor.what === 'confirmations') {
        await waitConf;
    } else {
        await waitNonceIncrease(web3, from, initialNonce, waitFor.pollMS);
    }
    return receipt;
}

function waitConfirmations(promiEvent: PromiEvent<any>, confirmationsRequired: number): Promise<void> {
    return new Promise((resolve, reject) => {
        promiEvent.on("confirmation", (confirmations) => {
            console.log("Confirmation", confirmations);
            if (confirmations >= confirmationsRequired) {
                resolve();
            }
        }).catch(ignore);
    });
}

async function waitNonceIncrease(web3: Web3, address: string, initialNonce: number, pollMS: number): Promise<void> {
    // eslint-disable-next-line no-constant-condition
    while (true) {
        const nonce = await web3.eth.getTransactionCount(address, 'latest');
        if (nonce > initialNonce) break;
        await sleep(pollMS);
    }
}

function preventUncaughtError<T>(promise: Promise<T>) {
    promise.catch(() => { /**/ });
    return promise; // will still reject everybody await-ing it
}

// testing/debugging flags - the defaults are optimal, but may be switched off in tests to access some parts of code
waitForFinalization.alwaysCheckFinishedOnReceipt = true;
waitForFinalization.cleanupHandlers = true;

/* istanbul ignore next */
function ignore(error: unknown) {
    // do nothing - the method can be used in promise `.catch()` to prevent
    // uncought error problems (when errors are properly caught elsewhere)
}

export const MiniTruffleContractsFunctions = {
    groupMethodOverloads,
    createMethodSignatureText: createMethodNameWithSignature,
    createMethodCalls,
    convertResults,
    executeMethodSend,
    executeMethodCall,
    executeMethodEstimateGas,
    waitForFinalization,
};
