// Configuration of source IDs
export enum SourceId {
    // Chain Sources should match the enum ChainType in flare-mcc library
    invalid = -1,
    BTC = 0,
    LTC = 1,
    DOGE = 2,
    XRP = 3,
    ALGO = 4,
}

export function getSourceName(sourceId: number): string | null {
    if (typeof SourceId[sourceId] === "undefined") {
        return null;
    }
    return SourceId[sourceId];
}

export function toSourceId(id: any): SourceId {
    if (typeof id === "number") return id as SourceId;
    const sourceId = SourceId[id];
    if (typeof sourceId === "undefined") return SourceId.invalid;
    return sourceId as any as SourceId;
}
