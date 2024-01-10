import coder from "web3-eth-abi";
import { AbiItem } from "web3-utils";
import { isNotNull, toBN } from "../helpers";
import { EvmEvent } from "./common";

export declare type RawEvent = import("web3-core").Log;

export class Web3EventDecoder {
    public eventTypes = new Map<string, AbiItem>(); // signature (topic[0]) => type

    constructor(abi: AbiItem[] = [], filter?: Array<string | undefined>) {
        this.addEvents(abi, filter);
    }

    addEvents(abi: AbiItem[], filter?: Array<string | undefined>) {
        for (const item of abi) {
            if (item.type === "event" && (filter == null || filter.includes(item.name))) {
                const signature = coder.encodeEventSignature(item);
                this.eventTypes.set(signature, item);
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
        /* istanbul ignore next */
        const abiInputs = evtType.inputs ?? [];
        const decodedArgs: Record<string, any> = coder.decodeLog(abiInputs, event.data, topics);
        // convert parameters based on type (BN for now)
        abiInputs.forEach((arg, i) => {
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
