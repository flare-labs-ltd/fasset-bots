import { RunConfig } from "../../src/config/BotConfig";
import { CreateOrmOptions } from "../../src/config/orm";
import { ActorEntity } from "../../src/entities/actor";
import { AgentEntity, AgentMinting, AgentRedemption } from "../../src/entities/agent";
import { WalletAddress } from "../../src/entities/wallet";
import { requireEnv } from "../../src/utils/helpers";
import { SourceId } from "../../src/verification/sources/sources";

export const LOCAL_HARDHAT_RPC = "http://127.0.0.1:8545";
export const HARDHAT_CONTRACTS_JSON = "../fasset/deployment/deploys/hardhat.json";
export const COSTON2_RPC: string = requireEnv('RPC_URL');
export const COSTON2_CONTRACTS_JSON = "../fasset/deployment/deploys/coston2.json";

export function createTestRunConfig(rpcUrl: string, contractsJsonFile: string, ormOptions: CreateOrmOptions, assetManager?: string, fAssetSymbol?: string) {
    return {
        rpcUrl: rpcUrl,
        loopDelay: 0,
        contractsJsonFile: contractsJsonFile,
        nativeChainInfo: {
            finalizationBlocks: 0,
            readLogsChunkSize: 10,
        },
        chainInfos: [{
            chainId: SourceId.XRP,
            name: "Ripple",
            symbol: "XRP",
            decimals: 6,
            amgDecimals: 0,
            requireEOAProof: false,
            assetManager: assetManager,
            fAssetSymbol: fAssetSymbol
        }],
        ormOptions: ormOptions
    } as RunConfig;
}

const testOptions: CreateOrmOptions = {
    entities: [WalletAddress, AgentEntity, AgentMinting, AgentRedemption, ActorEntity],
    type: 'sqlite',
    dbName: 'fasset-bots-test.db',
    debug: false,
    allowGlobalContext: true,
    schemaUpdate: 'full',
}

export function createTestOrmOptions(testOptionsOverride: CreateOrmOptions = {}) {
    return { ...testOptions, ...testOptionsOverride };
}
