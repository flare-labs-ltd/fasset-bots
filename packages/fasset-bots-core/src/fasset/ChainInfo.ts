import { ChainId } from "../underlying-chain/ChainId";

export interface ChainInfo {
    chainId: ChainId;   // combination of chain name and source id
    name: string;       // chain token name
    symbol: string;     // chain token symbol
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
