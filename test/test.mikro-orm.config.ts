import { Options } from "@mikro-orm/core";
import { AbstractSqlDriver } from "@mikro-orm/knex";
import { AgentEntity, Redemption, WalletAddress } from "../src/actors/entities";
import { createOrm, CreateOrmOptions, SchemaUpdate } from "../src/config/orm";

const testOptions: CreateOrmOptions = {
    entities: [WalletAddress, AgentEntity, Redemption],
    type: 'sqlite',
    dbName: 'fasset-bots-test.db',
    debug: false,
    allowGlobalContext: true,
    schemaUpdate: 'safe',
}

export async function createTestOrm(testOptionsOverride: Options<AbstractSqlDriver> = {}) {
    const options: Options<AbstractSqlDriver> = { ...testOptions, ...testOptionsOverride };
    return await createOrm(options);
}

export default testOptions;
