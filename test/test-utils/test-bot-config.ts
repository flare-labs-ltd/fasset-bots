import { CreateOrmOptions } from "../../src/config/orm";
import { AgentEntity, AgentMinting, AgentRedemption, EventEntity } from "../../src/entities/agent";
import { WalletAddress } from "../../src/entities/wallet";

export const OWNER_ADDRESS: string = "0xbaDC368bdCf8BB41FFF844bCF34a41968BdCe073";
export const COSTON_RPC: string = "https://coston-api.flare.network/ext/C/rpc";
export const COSTON_RUN_CONFIG_CONTRACTS = "./run-config/run-config-agent-coston-testxrp.json";
export const COSTON_RUN_CONFIG_ADDRESS_UPDATER = "./test/test-utils/run-config-test/run-config-coston-with-address-updater.json";
export const COSTON_SIMPLIFIED_RUN_CONFIG_CONTRACTS = "./test/test-utils/run-config-test/run-simplified-config-coston-with-contracts.json";
export const COSTON_SIMPLIFIED_RUN_CONFIG_ADDRESS_UPDATER = "./test/test-utils/run-config-test/run-simplified-config-coston-with-address-updater.json";
export const AGENT_DEFAULT_CONFIG_PATH = "./run-config/agent-settings-config.json";
export const COSTON_CONTRACTS_MISSING_SC = "./test/test-utils/run-config-test/contracts-missing-sc.json";
export const COSTON_CONTRACTS_MISSING_VERIFIER = "./test/test-utils/run-config-test/contracts-missing-verifier.json";

export const INDEXER_URL_XRP: string = "https://attestation-coston.aflabs.net/verifier/xrp";
export const ATTESTATION_PROVIDER_URLS: string[] = [
    "https://attestation-coston.aflabs.net/attestation-client",
    "https://attestation-coston.aflabs.net/attestation-client",
];
export const STATE_CONNECTOR_PROOF_VERIFIER_ADDRESS: string = "0x6356470e9aF457d1900Ad4Ed45D115192506BF51";
export const STATE_CONNECTOR_ADDRESS: string = "0x0c13aDA1C7143Cf0a0795FFaB93eEBb6FAD6e4e3";

const testOptions: CreateOrmOptions = {
    entities: [WalletAddress, AgentEntity, AgentMinting, AgentRedemption, EventEntity],
    type: "sqlite",
    dbName: "fasset-bots-test.db",
    debug: false,
    allowGlobalContext: true,
    schemaUpdate: "full",
};

export function createTestOrmOptions(testOptionsOverride: CreateOrmOptions = { type: "sqlite" }) {
    return { ...testOptions, ...testOptionsOverride };
}
