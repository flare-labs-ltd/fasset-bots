export interface ChainInfo {
    chainId: number;
    name: string;
    symbol: string;
    decimals: number;
    amgDecimals: number;
    requireEOAProof: boolean;
    finalizationBlocks: number;
}

export interface NativeChainInfo {
    finalizationBlocks: number;
    // maximum number of blocks in getPastLogs() call
    readLogsChunkSize: number;
}
