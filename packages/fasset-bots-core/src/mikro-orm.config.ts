import { Options } from "@mikro-orm/core";
import { AbstractSqlDriver } from "@mikro-orm/knex";
import { CreateOrmOptions, ORM, createOrm } from "./config/orm";
import { Secrets, getSecrets } from "./config/secrets";
import { AgentEntity, AgentMinting, AgentRedemption, Event } from "./entities/agent";
import { WalletAddress } from "./entities/wallet";

/* istanbul ignore next */
const options: Options<AbstractSqlDriver> = {
    entities: [WalletAddress, AgentEntity, AgentMinting, AgentRedemption, Event],
    dbName: "fasset-bots.db",
    debug: false
};

export async function overrideAndCreateOrm(optionsOverride: CreateOrmOptions): Promise<ORM> {
    let secrets = { database: {} } as Secrets;
    try { secrets = getSecrets(); } catch (e) { /* do nothing */ }
    const createOptions: CreateOrmOptions = { ...options, ...secrets.database, ...optionsOverride };
    return createOrm(createOptions);
}

export default options;
