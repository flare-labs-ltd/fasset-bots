import hash from "object-hash";

// same as Truffle.AnyEvent
export interface EventSelector {
    name: string;
    args: any;
}

export interface BaseEvent {
    address: string;
    event: string;
    args: any;
}

export interface EvmEvent {
    address: string;
    event: string;
    args: any;
    blockHash: string;
    blockNumber: number;
    logIndex: number;
    transactionHash: string;
    transactionIndex: number;
    type: string;
    signature: string;
}

export interface TypedEvent<A> extends BaseEvent {
    args: A;
}

export interface SelectedEvent<E extends EventSelector> extends BaseEvent {
    event: E["name"];
    args: E["args"];
}

export type NamedFields<T> = Omit<T, number>;

export type EventArgs<E extends EventSelector> = NamedFields<SelectedEvent<E>["args"]>;

export type ExtractEvent<E extends EventSelector, N extends E["name"]> = SelectedEvent<Extract<E, { name: N }>>;

export type ExtractedEventArgs<E extends EventSelector, N extends E["name"]> = NamedFields<ExtractEvent<E, N>["args"]>;

// takes first 5 bytes of event hash and converts it to a number
// node's max int is 9007199254740991 > 256**5 so no overflow
export function eventIndex(event: any): number {
    return parseInt(hash(event, { encoding: "hex" }).slice(0, 10), 16);
}
