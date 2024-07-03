import { Truffle } from "../../../typechain-truffle";
import { EventSelector, ExtractEvent, ExtractedEventArgs, BaseEvent, EvmEvent } from "./common";

// truffle typed event filtering

export type TruffleExtractEvent<E extends EventSelector, N extends E["name"]> = Truffle.TransactionLog<Extract<E, { name: N }>>;

export type ContractWithEventsBase = Truffle.ContractInstance & { "~eventMarker"?: any };
export type ContractWithEvents<C extends Truffle.ContractInstance, E extends EventSelector> = C & { "~eventMarker"?: E };

export type ContractTypeFor<T> = T extends ContractWithEvents<infer C, infer _E> ? C : never;
export type EventNamesFor<T> = T extends ContractWithEvents<infer _C, infer E> ? E["name"] : never;
export type EventForName<T, N extends EventNamesFor<T>> = T extends ContractWithEvents<infer _C, infer E> ? ExtractEvent<E, N> : never;
export type EventArgsForName<T, N extends EventNamesFor<T>> = T extends ContractWithEvents<infer _C, infer E> ? ExtractedEventArgs<E, N> : never;

export type EventsForMethod<C extends Truffle.ContractInstance, M extends keyof C> = C[M] extends (...args: any) => Promise<Truffle.TransactionResponse<infer E>> ? E : never;

export type ContractWithEventsForMethod<C extends Truffle.ContractInstance, M extends keyof C> = ContractWithEvents<C, EventsForMethod<C, M>>;

export function eventIs<C extends Truffle.ContractInstance, E extends EventSelector, N extends E["name"]>(event: BaseEvent, source: ContractWithEvents<C, E>, eventName: N): event is TruffleExtractEvent<E, N> {
    return event.address === source.address && event.event === eventName;
}

export function filterEvents<E extends EventSelector, N extends E["name"]>(response: Truffle.TransactionResponse<E>, name: N): TruffleExtractEvent<E, N>[] {
    return response.logs.filter((e) => e.event === name) as any;
}

export function filterEventList<C extends Truffle.ContractInstance, E extends EventSelector, N extends E["name"]>(list: EvmEvent[], source: ContractWithEvents<C, E>, eventName: N): TruffleExtractEvent<E, N>[] {
    return list.filter((e) => eventIs(e, source, eventName)) as any;
}

export function findEvent<E extends EventSelector, N extends E["name"]>(response: Truffle.TransactionResponse<E>, name: N): TruffleExtractEvent<E, N> | undefined {
    return response.logs.find((e) => e.event === name) as any;
}

export function findRequiredEvent<E extends EventSelector, N extends E["name"]>(response: Truffle.TransactionResponse<E>, name: N): TruffleExtractEvent<E, N> {
    const event = findEvent(response, name);
    if (event == null) {
        throw new Error(`Missing event ${name}`);
    }
    return event;
}

export function eventArgs<E extends EventSelector, N extends E["name"]>(response: Truffle.TransactionResponse<E>, name: N): ExtractedEventArgs<E, N> | undefined {
    return findEvent(response, name)?.args;
}

export function requiredEventArgs<E extends EventSelector, N extends E["name"]>(response: Truffle.TransactionResponse<E>, name: N): ExtractedEventArgs<E, N> {
    return findRequiredEvent(response, name).args;
}
