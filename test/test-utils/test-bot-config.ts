import { CreateOrmOptions } from "../../src/config/orm";
import { AgentEntity, AgentMinting, AgentRedemption } from "../../src/entities/agent";
import { WalletAddress } from "../../src/entities/wallet";
import { requireEnv } from "../../src/utils/helpers";

export const COSTON_RPC: string = requireEnv('RPC_URL');
export const COSTON_CONTRACTS_JSON = "../fasset/deployment/deploys/coston.json";
export const COSTON_RUN_CONFIG_CONTRACTS = "./run-config/run-config-coston-with-contracts.json";
export const COSTON_RUN_CONFIG_ADDRESS_UPDATER = "./run-config/run-config-coston-with-address-updater.json";
export const COSTON_SIMPLIFIED_RUN_CONFIG_CONTRACTS = "./run-config/run-simplified-config-coston-with-contracts.json";
export const COSTON_SIMPLIFIED_RUN_CONFIG_ADDRESS_UPDATER = "./run-config/run-simplified-config-coston-with-address-updater.json";

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
