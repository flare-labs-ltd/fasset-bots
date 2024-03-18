import { copyFile } from "fs/promises";
import { CreateOrmOptions, ORM } from "../../src/config/orm";
import { AgentEntity, AgentMinting, AgentRedemption, Event } from "../../src/entities/agent";
import { WalletAddress } from "../../src/entities/wallet";
import { overrideAndCreateOrm } from "../../src/mikro-orm.config";

export const OWNER_ADDRESS: string = "0xbaDC368bdCf8BB41FFF844bCF34a41968BdCe073";
export const COSTON_RPC: string = "https://coston-api.flare.network/ext/C/rpc";
export const COSTON_RUN_CONFIG_CONTRACTS = "./run-config/coston-bot.json";
export const COSTON_TEST_AGENT_SETTINGS = "./test/test-utils/run-config-test/agent-settings-config-test.json";
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
    entities: [WalletAddress, AgentEntity, AgentMinting, AgentRedemption, Event],
    type: "sqlite",
    dbName: "fasset-bots-test.db",
    debug: false,
    allowGlobalContext: true,
    schemaUpdate: "recreate",
};

export function createTestOrmOptions(testOptionsOverride: Partial<CreateOrmOptions> = {}): CreateOrmOptions {
    return { ...testOptions, ...testOptionsOverride };
}

export async function createTestOrm(testOptionsOverride: Partial<CreateOrmOptions> = {}) {
    const options = createTestOrmOptions(testOptionsOverride);
    const orm = await overrideAndCreateOrm(options);
    ormInitOptions.set(orm, options);
    return orm;
}

const ormInitOptions: WeakMap<ORM, CreateOrmOptions> = new WeakMap();
const ormCopies: WeakMap<ORM, ORM> = new WeakMap();

export function isRegisteredORM(value: unknown): value is ORM {
    return ormInitOptions.has(value as ORM);
}

export async function copyORM(orm: ORM) {
    const options = ormInitOptions.get(orm)!;
    if (options.type !== 'sqlite' || options.dbName == null) {
        throw new Error("Only for SQLite");
    }
    // clear and close old (on first run, before any copy is made, close the original)
    const ormToClose = ormCopies.get(orm) ?? orm;
    await ormToClose.em.flush();
    ormToClose.em.clear();
    await ormToClose.close();
    // copy sqlite db file
    const dbName = options.dbName.replace(/\.db$/, `.copy.db`);
    await copyFile(options.dbName, dbName);
    return await overrideAndCreateOrm({ ...options, dbName, schemaUpdate: "none" });
}
