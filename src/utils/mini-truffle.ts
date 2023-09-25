/* eslint-disable @typescript-eslint/no-unused-vars */

import Web3 from "web3";
import coder from "web3-eth-abi";
import { AbiOutput } from "web3-utils";
import { Web3EventDecoder } from "./events/Web3EventDecoder";
import { fail, getOrCreate, toBN } from "./helpers";
import { web3DeepNormalize } from "./web3normalize";

type TransactionWaitFor = 'receipt' | 'nonceIncrease' | { confirmations: number };

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

class ContractInstance implements Truffle.ContractInstance {
    constructor(
        public _contractFactory: ContractFactory,
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
        return this._settings.web3.eth.sendTransaction({ ...this._settings.defaultOptions, ...transactionConfig });
    }
}

export class ContractFactory implements Truffle.Contract<any> {
    constructor(
        public settings: ContractSettings,
        public contractName: string,
        public abi: AbiItem[],
        public contractJson?: ContractJson,  // only needed for new
    ) {
    }

    instanceConstructor = createContractInstanceConstructor(this.settings, this.contractName, this.abi);

    constructorAbi?: AbiItem = this.abi.find(it => it.type === 'constructor');

    eventDecoder = new Web3EventDecoder(this.abi);

    address = undefined as any;  // typing in typechain is wrong - should be optional

    async deployed(): Promise<any> {
        if (!this.address) {
            throw new Error("not deployed from this contract");
        }
        return new this.instanceConstructor(this, this.settings, this.address);
    }

    async at(address: string): Promise<any> {
        return new this.instanceConstructor(this, this.settings, address);
    }

    async "new"(...args: any[]): Promise<any> {
        if (this.constructorAbi == null) {
            throw new Error("The contract is abstract; cannot deploy");
        }
        if (this.contractJson == null) {
            throw new Error("Full contract JSON needed for deploy");
        }
        const web3Contract = new this.settings.web3.eth.Contract(this.abi);
        const [methodArgs, config] = splitMethodArgs(this.constructorAbi, args);
        const data = web3Contract.deploy({ data: this.contractJson.bytecode, arguments: formatArguments(methodArgs) }).encodeABI();
        const result = await executeMethodSend(this.settings, data, config);
        if (result.contractAddress == null) {
            throw new Error("Deploy failed");
        }
        const instance = new this.instanceConstructor(this, this.settings, result.contractAddress);
        instance.transactionHash = result.transactionHash;
        this.address = result.contractAddress;
        return instance;
    }

    link(...args: any) {
        if (!(args.length === 1 && args[0] instanceof ContractInstance)) {
            throw new Error("Only supported `link(instance)`");
        }
        const instance = args[0];
        if (this.contractJson == null || instance._contractFactory.contractJson == null) {
            throw new Error("Full contract JSON needed for link");
        }
        const { contractName, sourceName } = instance._contractFactory.contractJson;
        const linkRefs = this.contractJson.linkReferences[sourceName][contractName] ?? [];
        for (const { start, length } of linkRefs) {
            this.contractJson.bytecode = this.contractJson.bytecode.slice(0, 2 * start + 2) +
                instance.address.slice(2).toLowerCase() + this.contractJson.bytecode.slice(2 * (start + length) + 2);
        }
    }
}

interface ContractInstanceConstructor {
    new(contractFactory: ContractFactory, settings: ContractSettings, address: string): ContractInstance;
}

function createContractInstanceConstructor(settings: ContractSettings, contractName: string, abi: AbiItem[]): ContractInstanceConstructor {
    const contractConstructor = class extends ContractInstance {
        constructor(contractFactory: ContractFactory, settings: ContractSettings, address: string) {
            super(contractFactory, settings, address, abi);
        }
    }
    Object.defineProperty(contractConstructor, 'name', { value: contractName, writable: false });
    const prototype: any = contractConstructor.prototype;
    // prototype.methods = {};
    for (const method of createNamedMethods(abi).values()) {
        for (const [namesig, item] of method.overloads) {
            const calls = createMethodCalls(settings, item);
            // prototype.methods[namesig] = calls;
            if (prototype[namesig] === undefined) { // do not overwrite predefined methods
                prototype[namesig] = calls;
            }
            if (method.overloads.size === 1) {
                // prototype.methods[method.name] = calls;
                if (prototype[method.name] === undefined) { // do not overwrite predefined methods
                    prototype[method.name] = calls;
                }
            }
        }
    }
    return contractConstructor;
}

function createMethodCalls(settings: ContractSettings, method: AbiItem) {
    const sendFn = async function (this: ContractInstance, ...args: any[]) {
        const [methodArgs, config] = splitMethodArgs(method, args);
        const encodedArgs = coder.encodeFunctionCall(method, formatArguments(methodArgs));
        const receipt = await executeMethodSend(settings, encodedArgs, { to: this.address, ...config });
        const logs = this._contractFactory.eventDecoder.decodeEvents(receipt.logs);
        return { tx: receipt.transactionHash, receipt, logs };
    }
    const callFn = async function (this: ContractInstance, ...args: any[]) {
        const [methodArgs, config] = splitMethodArgs(method, args);
        const encodedArgs = coder.encodeFunctionCall(method, formatArguments(methodArgs));
        const encResult = await executeMethodCall(settings, encodedArgs, { to: this.address, ...config });
        const outputs = method.outputs ?? [];
        return convertResults(outputs, coder.decodeParameters(outputs, encResult));
    }
    const estimateGasFn = async function (this: ContractInstance, ...args: any[]) {
        const [methodArgs, config] = splitMethodArgs(method, args);
        const encodedArgs = coder.encodeFunctionCall(method, formatArguments(methodArgs));
        return executeMethodEstimateGas(settings, encodedArgs, { to: this.address, ...config });
    }
    const mainFn: any = method.constant ? callFn : sendFn;
    mainFn.call = callFn;
    mainFn.sendTransaction = sendFn;
    mainFn.estimateGas = estimateGasFn;
    return mainFn;
}

interface AbiNamedMethod {
    name: string;
    overloads: Map<string, AbiItem>;
}

function createNamedMethods(abi: AbiItem[]) {
    const namedMethods: Map<string, AbiNamedMethod> = new Map();
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

function splitMethodArgs(method: AbiItem, args: any[]): [methodArgs: any[], config: TransactionConfig] {
    const paramsLen = method.inputs?.length ?? 0;
    if (args.length < paramsLen) throw new Error("Not enough arguments");
    if (args.length > paramsLen + 1) throw new Error("Too many arguments");
    return args.length > paramsLen ? [args.slice(0, paramsLen), args[paramsLen]] : [args, {}];
}

async function executeMethodSend(settings: ContractSettings, encodedCall: string, transactionConfig: TransactionConfig) {
    const { web3, gasMultiplier, waitFor, defaultOptions } = settings;
    const config: TransactionConfig = { ...defaultOptions, ...transactionConfig, data: encodedCall };
    if (config.gas == null) {
        // estimate gas; should also throw nice errors
        const gas = await web3.eth.estimateGas(config);
        config.gas = gas * gasMultiplier;
    } else {
        // do a call to catch errors without wasting gas for transaction
        await web3.eth.call(config);
    }
    const from = typeof config.from === 'string' ? config.from : fail("'from' field is mandatory");
    const nonce = waitFor === 'nonceIncrease' ? await web3.eth.getTransactionCount(from, 'latest') : 0;
    const promiEvent = web3.eth.sendTransaction(config);
    return await waitForFinalization(web3, waitFor, nonce, from, promiEvent);
}

async function executeMethodCall(settings: ContractSettings, encodedCall: string, transactionConfig: TransactionConfig) {
    const { web3, defaultOptions } = settings;
    const config: TransactionConfig = { ...defaultOptions, ...transactionConfig, data: encodedCall };
    return await web3.eth.call(config);
}

async function executeMethodEstimateGas(settings: ContractSettings, encodedCall: string, transactionConfig: TransactionConfig) {
    const { web3, defaultOptions } = settings;
    const config: TransactionConfig = { ...defaultOptions, ...transactionConfig, data: encodedCall };
    return await web3.eth.estimateGas(config);
}

function waitForFinalization(web3: Web3, waitFor: TransactionWaitFor, initialNonce: number, from: string, promiEvent: PromiEvent<any>): Promise<TransactionReceipt> {
    return new Promise((resolve, reject) => {
        let finished = false;
        let timer: NodeJS.Timer | number | null = null;
        let receipt: TransactionReceipt | null = null;
        function cleanup() {
            if (timer != null) {
                clearInterval(timer);
            }
        }
        function checkFinished(finishCondition: boolean) {
            finished ||= finishCondition;
            if (finished && receipt != null) {
                cleanup();
                resolve(receipt);
            }
        }
        void promiEvent.on("error", (error) => {
            cleanup();
            reject(error);
        });
        void promiEvent.on("receipt", (rec) => {
            receipt = rec;
            checkFinished(waitFor === 'receipt');
        });
        if (waitFor === 'nonceIncrease') {
            timer = setInterval(preventReentrancy(async () => {
                const nonce = await web3.eth.getTransactionCount(from, 'latest');
                checkFinished(nonce > initialNonce);
            }), 1000);
        } else if (typeof waitFor === 'object') {
            const confirmations = waitFor.confirmations;
            void promiEvent.on("confirmation", (confNumber) => {
                checkFinished(confNumber >= confirmations);
            });
        }
    });
}

function preventReentrancy(method: () => Promise<void>) {
    let inMethod = false;
    return async () => {
        if (inMethod) return;
        inMethod = true;
        try {
            await method();
        } finally {
            inMethod = false;
        }
    }
}
