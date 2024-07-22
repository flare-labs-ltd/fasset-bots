import { ChainType } from "./constants";

const chainTypeLocks = new Map<ChainType, boolean>();

export function isChainTypeLocked(chainType: ChainType): boolean {
    return chainTypeLocks.get(chainType) || false;
}

export function lockChainType(chainType: ChainType): void {
    chainTypeLocks.set(chainType, true);
}

export function unlockChainType(chainType: ChainType): void {
    chainTypeLocks.delete(chainType);
}