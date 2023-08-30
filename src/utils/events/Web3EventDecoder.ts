import { isNotNull, toBN } from "../helpers";
import { EvmEvent } from "./common";
import { web3 } from "../web3";

export declare type RawEvent = import("web3-core").Log;

export class Web3EventDecoder {
    public eventTypes = new Map<string, AbiItem>(); // signature (topic[0]) => type
    public contractNames = new Map<string, string>(); // address => name

    constructor(contracts: { [name: string]: Truffle.ContractInstance }, filter?: string[]) {
        this.addContracts(contracts, filter);
    }

    addContracts(contracts: { [name: string]: Truffle.ContractInstance }, filter?: string[]) {
        for (const contractName of Object.keys(contracts)) {
            const contract = contracts[contractName];
            this.contractNames.set(contract.address, contractName);
            for (const item of contract.abi) {
                if (item.type === "event" && (filter == null || filter.includes(item.name!))) {
                    this.eventTypes.set((item as any).signature, item);
                }
            }
        }
    }

    decodeEvent(event: RawEvent): EvmEvent | null {
        const signature = event.topics[0];
        const evtType = this.eventTypes.get(signature);
        if (evtType == null) {
            return null;
        }
        // based on web3 docs, first topic has to be removed for non-anonymous events
        const topics = evtType.anonymous ? event.topics : event.topics.slice(1);
        const decodedArgs: any = web3.eth.abi.decodeLog(evtType.inputs!, event.data, topics);
        // convert parameters based on type (BN for now)
        evtType.inputs!.forEach((arg, i) => {
            if (/^u?int\d*$/.test(arg.type)) {
                decodedArgs[i] = decodedArgs[arg.name] = toBN(decodedArgs[i]);
            } else if (/^u?int\d*\[\]$/.test(arg.type)) {
                decodedArgs[i] = decodedArgs[arg.name] = decodedArgs[i].map(toBN);
            }
        });
        return {
            address: event.address,
            type: evtType.type,
            signature: signature,
            event: evtType.name ?? "<unknown>",
            args: decodedArgs,
            blockHash: event.blockHash,
            blockNumber: event.blockNumber,
            logIndex: event.logIndex,
            transactionHash: event.transactionHash,
            transactionIndex: event.transactionIndex,
        };
    }

    decodeEvents(rawLogs: RawEvent[]): EvmEvent[] {
        return rawLogs.map((log) => this.decodeEvent(log)).filter(isNotNull);
    }
}
