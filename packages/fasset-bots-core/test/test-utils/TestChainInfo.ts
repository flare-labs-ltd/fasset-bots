import { AgentBotSettings, AgentSettingsConfigDefaults } from "../../src/config";
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

export type TestChainType = "eth" | "btc" | "xrp" | "doge";

export const testChainInfo: Record<TestChainType, TestChainInfo> = {
    eth: {
        chainId: ChainId.from("testETH"),
        name: "Ethereum",
        symbol: "ETH",
        decimals: 18,
        amgDecimals: 9,
        minimumAccountBalance: BN_ZERO,
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
        startPrice: 25213.0,
        blockTime: 600,
        finalizationBlocks: 6,
        underlyingBlocksForPayment: 8,
        lotSize: 2,
        requireEOAProof: false,
    },
    doge: {
        chainId: ChainId.testBTC,
        name: "DOGECoin",
        symbol: "DOGE",
        decimals: 8,
        amgDecimals: 8,
        minimumAccountBalance: BN_ZERO,
        startPrice: 0.6,
        blockTime: 60,
        finalizationBlocks: 50,
        underlyingBlocksForPayment: 60,
        lotSize: 20,
        requireEOAProof: false,
    },
    xrp: {
        chainId: ChainId.testXRP,
        name: "XRP",
        symbol: "XRP",
        decimals: 6,
        amgDecimals: 6,
        minimumAccountBalance: toBNExp(10, 6),
        startPrice: 0.53,
        blockTime: 4,
        finalizationBlocks: 3,
        underlyingBlocksForPayment: 10,
        lotSize: 10,
        requireEOAProof: false,
    },
};

export const defaultCreateAgentSettings: AgentSettingsConfigDefaults = {
    fee: "1%",
    poolFeeShare: "40%",
    mintingVaultCollateralRatio: "1.6",
    mintingPoolCollateralRatio: "2.3",
    poolExitCollateralRatio: "2.3",
    poolTopupCollateralRatio: "2.1",
    poolTopupTokenPriceFactor: "0.9",
    buyFAssetByAgentFactor: "0.99",
    handshakeType: 0
};

export const parallelBots = false;

export const testAgentBotSettings: Record<TestChainType, AgentBotSettings> = {
    eth: {
        parallel: parallelBots,
        trustedPingSenders: new Set([]),
        liquidationPreventionFactor: 1.2,
        vaultCollateralReserveFactor: 0.1,
        poolCollateralReserveFactor: 0.1,
        minimumFreeUnderlyingBalance: toBNExp(0.01, 18),
        recommendedOwnerUnderlyingBalance: toBNExp(0.1, 18),
        minBalanceOnServiceAccount: toBNExp(2, 18),
        minBalanceOnWorkAccount: toBNExp(200, 18),
        defaultAgentSettings: defaultCreateAgentSettings,
        feeSafetyFactorPerKB: 0
    },
    btc: {
        parallel: parallelBots,
        trustedPingSenders: new Set([]),
        liquidationPreventionFactor: 1.2,
        vaultCollateralReserveFactor: 0.1,
        poolCollateralReserveFactor: 0.1,
        minimumFreeUnderlyingBalance: toBNExp(0.001, 8),
        recommendedOwnerUnderlyingBalance: toBNExp(0.1, 8),
        minBalanceOnServiceAccount: toBNExp(2, 18),
        minBalanceOnWorkAccount: toBNExp(200, 18),
        defaultAgentSettings: defaultCreateAgentSettings,
        feeSafetyFactorPerKB: 0
    },
    xrp: {
        parallel: parallelBots,
        trustedPingSenders: new Set([]),
        liquidationPreventionFactor: 1.2,
        vaultCollateralReserveFactor: 0.1,
        poolCollateralReserveFactor: 0.1,
        minimumFreeUnderlyingBalance: toBNExp(12, 6),
        recommendedOwnerUnderlyingBalance: toBNExp(50, 6),
        minBalanceOnServiceAccount: toBNExp(2, 18),
        minBalanceOnWorkAccount: toBNExp(200, 18),
        defaultAgentSettings: defaultCreateAgentSettings,
        feeSafetyFactorPerKB: 0
    },
    doge: {
        parallel: parallelBots,
        trustedPingSenders: new Set([]),
        liquidationPreventionFactor: 1.2,
        vaultCollateralReserveFactor: 0.1,
        poolCollateralReserveFactor: 0.1,
        minimumFreeUnderlyingBalance: toBNExp(12, 6),
        recommendedOwnerUnderlyingBalance: toBNExp(50, 6),
        minBalanceOnServiceAccount: toBNExp(2, 18),
        minBalanceOnWorkAccount: toBNExp(200, 18),
        defaultAgentSettings: defaultCreateAgentSettings,
        feeSafetyFactorPerKB: 0
    },
}

for (const [key, ci] of Object.entries(testChainInfo)) {
    testAgentBotSettings[ci.chainId.chainName as TestChainType] = testAgentBotSettings[key as TestChainType];
}
