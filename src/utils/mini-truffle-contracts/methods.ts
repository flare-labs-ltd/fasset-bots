import coder from "web3-eth-abi";
import { AbiOutput } from "web3-utils";
import { getOrCreate, toBN } from "../helpers";
import { web3DeepNormalize } from "../web3normalize";
import { waitForFinalization } from "./finalization";
import { ContractSettings } from "./types";
import { MiniTruffleContract, MiniTruffleContractInstance } from "./contracts";

export interface ContractInstanceConstructor {
    new(contractFactory: MiniTruffleContract, settings: ContractSettings, address: string): MiniTruffleContractInstance;
}

export function createContractInstanceConstructor(contractName: string): ContractInstanceConstructor {
    const contractConstructor = class extends MiniTruffleContractInstance {
        constructor(contractFactory: MiniTruffleContract, settings: ContractSettings, address: string) {
            super(contractFactory, settings, address, contractFactory.abi);
            addContractMethods(this, contractFactory.abi);
        }
    };
    Object.defineProperty(contractConstructor, 'name', { value: contractName, writable: false });
    return contractConstructor;
}

function addContractMethods(instance: MiniTruffleContractInstance & { [method: string]: any; }, abi: AbiItem[]) {
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
    };
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
    };
    const estimateGasFn = async function (...args: any[]) {
        // console.log(`estimateGas ${method.name}`);
        const [methodArgs, config] = splitMethodArgs(method, args);
        const encodedArgs = coder.encodeFunctionCall(method, formatArguments(methodArgs));
        return executeMethodEstimateGas(instance._settings, { ...config, to: instance.address, data: encodedArgs });
    };
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

export async function executeConstructor(settings: ContractSettings, abi: AbiItem[], bytecode: string, args: any[]) {
    const constructorAbi = abi.find(it => it.type === 'constructor');
    const [methodArgs, config] = splitMethodArgs(constructorAbi, args);
    const encodedArgs = constructorAbi?.inputs != null ? coder.encodeParameters(constructorAbi.inputs, methodArgs) : '';
    // deploy data must be bytecode followed by the abi encoded args
    const data = bytecode + encodedArgs.slice(2);
    return await executeMethodSend(settings, { ...config, data: data });
}

async function executeMethodSend(settings: ContractSettings, transactionConfig: TransactionConfig) {
    const { web3, gasMultiplier, waitFor } = settings;
    const config = mergeConfig(settings, transactionConfig);
    if (typeof config.from !== 'string') {
        throw new Error("'from' field is mandatory");
    }
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

function mergeConfig(settings: ContractSettings, transactionConfig: TransactionConfig): TransactionConfig {
    const config: TransactionConfig = { ...settings.defaultOptions, ...transactionConfig };
    if (config.from == null && settings.defaultAccount != null) {
        config.from = settings.defaultAccount;
    }
    return config;
}
