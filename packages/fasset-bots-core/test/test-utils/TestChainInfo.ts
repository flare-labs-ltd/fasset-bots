import { ChainInfo, NativeChainInfo } from "../../src/fasset/ChainInfo";
import { ChainId } from "../../src/underlying-chain/ChainId";

export interface TestNatInfo {
    name: string;
    symbol: string;
    startPrice: number;
}

export const testNatInfo: TestNatInfo = {
    name: "NetworkNative",
    symbol: "NAT",
    startPrice: 0.42,
};

export interface TestChainInfo extends ChainInfo {
    startPrice: number;
    blockTime: number;
    finalizationBlocks: number;
    underlyingBlocksForPayment: number;
    lotSize: number;
    parameterFile?: string;
}

export const testNativeChainInfo: NativeChainInfo = {
    chainName: "Native",
    tokenSymbol: "NAT",
    finalizationBlocks: 0,
    readLogsChunkSize: 10,
};

export const testChainInfo: Record<"eth" | "btc" | "xrp", TestChainInfo> = {
    eth: {
        chainId: ChainId.LTC,
        name: "Ethereum",
        symbol: "ETH",
        decimals: 18,
        amgDecimals: 9,
        startPrice: 1621.0,
        blockTime: 12,
        finalizationBlocks: 6,
        underlyingBlocksForPayment: 10,
        lotSize: 30,
        requireEOAProof: true,
    },
    btc: {
        chainId: ChainId.testBTC,
        name: "Bitcoin",
        symbol: "BTC",
        decimals: 8,
        amgDecimals: 8,
        startPrice: 25213.0,
        blockTime: 600,
        finalizationBlocks: 6,
        underlyingBlocksForPayment: 8,
        lotSize: 2,
        requireEOAProof: false,
    },
    xrp: {
        chainId: ChainId.testXRP,
        name: "XRP",
        symbol: "XRP",
        decimals: 6,
        amgDecimals: 6,
        startPrice: 0.53,
        blockTime: 4,
        finalizationBlocks: 3,
        underlyingBlocksForPayment: 10,
        lotSize: 10,
        requireEOAProof: false,
    },
};
