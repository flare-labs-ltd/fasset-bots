import { CreateOrmOptions } from "../../src/config/orm";
import { ActorEntity } from "../../src/entities/actor";
import { AgentEntity, AgentMinting, AgentRedemption } from "../../src/entities/agent";
import { WalletAddress } from "../../src/entities/wallet";
import { requireEnv } from "../../src/utils/helpers";

export const LOCAL_HARDHAT_RPC = "http://127.0.0.1:8545";
export const HARDHAT_CONTRACTS_JSON = "../fasset/deployment/deploys/hardhat.json";
export const COSTON2_RPC: string = requireEnv('RPC_URL');
export const COSTON2_CONTRACTS_JSON = "../fasset/deployment/deploys/coston2.json";
export const LOCAL_HARDHAT_RUN_CONFIG = "./run-config/run-config-local.json";
export const COSTON2_RUN_CONFIG_CONTRACTS = "./run-config/run-config-coston2-with-contracts.json";
export const COSTON2_RUN_CONFIG_ADDRESS_UPDATER = "./run-config/run-config-coston2-with-address-updater.json";

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
