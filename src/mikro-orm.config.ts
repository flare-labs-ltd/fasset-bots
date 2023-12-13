import { Options } from "@mikro-orm/core";
import { AbstractSqlDriver } from "@mikro-orm/knex";
import { AgentEntity, AgentMinting, AgentRedemption } from "./entities/agent";
import { WalletAddress } from "./entities/wallet";
import { createOrm, CreateOrmOptions, ORM } from "./config/orm";
import { PostgreSqlDriver } from "@mikro-orm/postgresql";
import { Secrets, getSecrets } from "./config/secrets";

/* istanbul ignore next */
const options: Options<AbstractSqlDriver | PostgreSqlDriver> = {
    entities: [WalletAddress, AgentEntity, AgentMinting, AgentRedemption],
    dbName: "fasset-bots.db",
    debug: false
};

export async function overrideAndCreateOrm(optionsOverride: CreateOrmOptions): Promise<ORM> {
    let secrets = { database: {} } as Secrets;
    try { secrets = getSecrets(); } catch (e) {}
    const createOptions: CreateOrmOptions = { ...options, ...secrets.database, ...optionsOverride };
    return createOrm(createOptions);
}

export default options;
