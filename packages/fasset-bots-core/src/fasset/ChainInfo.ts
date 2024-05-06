import { ChainId } from "../underlying-chain/SourceId";

export interface ChainInfo {
    chainId: ChainId;
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
