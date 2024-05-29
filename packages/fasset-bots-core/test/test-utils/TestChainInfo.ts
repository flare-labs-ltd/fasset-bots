import { AgentBotSettings } from "../../src/config";
import { ChainInfo, NativeChainInfo } from "../../src/fasset/ChainInfo";
import { ChainId } from "../../src/underlying-chain/ChainId";
import { BN_ZERO, toBNExp } from "../../src/utils";

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

export type TestChainType = "eth" | "btc" | "xrp";

export const testChainInfo: Record<TestChainType, TestChainInfo> = {
    eth: {
        chainId: ChainId.LTC,
        name: "Ethereum",
        symbol: "ETH",
        decimals: 18,
        amgDecimals: 9,
        minimumAccountBalance: BN_ZERO,
        // recommendedOwnerBalance: toBNExp("0.1", 18),
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
        minimumAccountBalance: BN_ZERO,
        // recommendedOwnerBalance: toBNExp("0.01", 8),
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
        minimumAccountBalance: toBNExp(10, 6),
        // recommendedOwnerBalance: toBNExp(50, 6),
        startPrice: 0.53,
        blockTime: 4,
        finalizationBlocks: 3,
        underlyingBlocksForPayment: 10,
        lotSize: 10,
        requireEOAProof: false,
    },
};

export const testAgentBotSettings: Record<string, AgentBotSettings> = {
    "ETH": {
        liquidationPreventionFactor: 1.2,
        vaultCollateralReserveFactor: 0.1,
        poolCollateralReserveFactor: 0.1,
        minimumVaultUnderlyingBalance: toBNExp(0.01, 18),
        recommendedOwnerUnderlyingBalance: toBNExp(0.1, 18),
    },
    "BTC": {
        liquidationPreventionFactor: 1.2,
        vaultCollateralReserveFactor: 0.1,
        poolCollateralReserveFactor: 0.1,
        minimumVaultUnderlyingBalance: toBNExp(0.001, 8),
        recommendedOwnerUnderlyingBalance: toBNExp(0.1, 8),
    },
    "XRP": {
        liquidationPreventionFactor: 1.2,
        vaultCollateralReserveFactor: 0.1,
        poolCollateralReserveFactor: 0.1,
        minimumVaultUnderlyingBalance: toBNExp(12, 6),
        recommendedOwnerUnderlyingBalance: toBNExp(50, 6),
    }
}
