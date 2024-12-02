// same as Truffle.AnyEvent
export interface EventSelector {
    name: string;
    args: unknown;
}

export interface BaseEvent {
    address: string;
    event: string;
    args: unknown;
}

export interface EvmEvent {
    address: string;
    event: string;
    args: unknown;
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

interface EventId {
    blockNumber: number;
    transactionIndex: number;
    logIndex: number;
}

// order function when comparing two events
export function eventOrder(event1: EventId, event2: EventId): number {
    if (event1.blockNumber !== event2.blockNumber) {
        return event1.blockNumber - event2.blockNumber;
    } else if (event1.transactionIndex !== event2.transactionIndex) {
        return event1.transactionIndex - event2.transactionIndex;
    } else {
        return event1.logIndex - event2.logIndex;
    }
}
