import { createOrm, CreateOrmOptions } from "../src/config/orm";
import { ActorEntity } from "../src/entities/actor";
import { AgentEntity, AgentMinting, AgentRedemption } from "../src/entities/agent";
import { WalletAddress } from "../src/entities/wallet";

const testOptions: CreateOrmOptions = {
    entities: [WalletAddress, AgentEntity, AgentMinting, AgentRedemption, ActorEntity],
    type: 'sqlite',
    dbName: 'fasset-bots-test.db',
    debug: false,
    allowGlobalContext: true,
    schemaUpdate: 'full',
}

export async function createTestOrm(testOptionsOverride: CreateOrmOptions = {}) {
    const options: CreateOrmOptions = { ...testOptions, ...testOptionsOverride };
    return await createOrm(options);
}

export default testOptions;
