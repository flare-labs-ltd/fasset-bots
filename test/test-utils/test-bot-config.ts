import { BotConfig, BotConfigChain, createBotConfigChain, createStateConnectorClient, RunConfig } from "../../src/config/BotConfig";
import { CreateOrmOptions } from "../../src/config/orm";
import { AgentEntity, AgentMinting, AgentRedemption } from "../../src/entities/agent";
import { WalletAddress } from "../../src/entities/wallet";
import { overrideAndCreateOrm } from "../../src/mikro-orm.config";
import { requireEnv } from "../../src/utils/helpers";
import { Notifier } from "../../src/utils/Notifier";

export const LOCAL_HARDHAT_RPC = "http://127.0.0.1:8545";
export const HARDHAT_CONTRACTS_JSON = "../fasset/deployment/deploys/hardhat.json";
export const COSTON2_RPC: string = requireEnv('RPC_URL');
export const COSTON2_CONTRACTS_JSON = "../fasset/deployment/deploys/coston2.json";
export const LOCAL_HARDHAT_RUN_CONFIG = "./run-config/run-config-local.json";
export const COSTON2_RUN_CONFIG_CONTRACTS = "./run-config/run-config-coston2-with-contracts.json";
export const COSTON2_RUN_CONFIG_ADDRESS_UPDATER = "./run-config/run-config-coston2-with-address-updater.json";

const RPC_URL_LOCAL: string = requireEnv('RPC_URL_LOCAL');
const ATTESTATION_PROVIDER_URLS_LOCAL: string  = requireEnv('ATTESTER_BASE_URLS_LOCAL');
const ATTESTATION_CLIENT_ADDRESS_LOCAL: string = requireEnv('ATTESTATION_CLIENT_ADDRESS_LOCAL');
const STATE_CONNECTOR_ADDRESS_LOCAL: string  = requireEnv('STATE_CONNECTOR_ADDRESS_LOCAL');

const testOptions: CreateOrmOptions = {
    entities: [WalletAddress, AgentEntity, AgentMinting, AgentRedemption],
    type: 'sqlite',
    dbName: 'fasset-bots-test.db',
    debug: false,
    allowGlobalContext: true,
    schemaUpdate: 'full',
}

export function createTestOrmOptions(testOptionsOverride: CreateOrmOptions = {}) {
    return { ...testOptions, ...testOptionsOverride };
}

export async function createBotConfigLocal(runConfig: RunConfig, ownerAddress: string): Promise<BotConfig> {
    const attestationProviderUrls = ATTESTATION_PROVIDER_URLS_LOCAL.split(",");
    const stateConnector = await createStateConnectorClient(attestationProviderUrls, ATTESTATION_CLIENT_ADDRESS_LOCAL, STATE_CONNECTOR_ADDRESS_LOCAL, ownerAddress);
    const orm = await overrideAndCreateOrm(runConfig.ormOptions);
    const chains: BotConfigChain[] = [];
    for (const chainInfo of runConfig.chainInfos) {
        chains.push(await createBotConfigChain(chainInfo, orm.em));
    }
    return {
        rpcUrl: RPC_URL_LOCAL,
        loopDelay: runConfig.loopDelay,
        stateConnector: stateConnector,
        chains: chains,
        nativeChainInfo: runConfig.nativeChainInfo,
        orm: orm,
        notifier: new Notifier(),
        addressUpdater: runConfig.addressUpdater,
        contractsJsonFile: runConfig.contractsJsonFile
    };
}