import { ChainInfo } from "../../src/fasset/ChainInfo";
import { SourceId } from "../../src/verification/sources/sources";

export interface TestChainInfo extends ChainInfo {
    blockTime: number;
    finalizationBlocks: number;
}

export const testChainInfo: { [name: string]: TestChainInfo } = {
    btc: {
        chainId: SourceId.BTC,
        name: "Bitcoin",
        symbol: "BTC",
        decimals: 8,
        amgDecimals: 0,
        blockTime: 600,
        finalizationBlocks: 6,
        requireEOAProof: false,
    },
    xrp: {
        chainId: SourceId.XRP,
        name: "Ripple",
        symbol: "XRP",
        decimals: 6,
        amgDecimals: 0,
        blockTime: 10,
        finalizationBlocks: 6,
        requireEOAProof: false,
    }
}
