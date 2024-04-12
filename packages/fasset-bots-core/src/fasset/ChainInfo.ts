export interface ChainInfo {
    chainId: string;
    name: string;
    symbol: string;
    decimals: number;
    amgDecimals: number;
    requireEOAProof: boolean;
}

export interface NativeChainInfo {
    chainName: string;
    tokenSymbol: string;
    finalizationBlocks: number;
    // maximum number of blocks in getPastLogs() call
    readLogsChunkSize: number;
}
