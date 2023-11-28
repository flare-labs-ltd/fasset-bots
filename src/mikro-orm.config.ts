import { Options } from "@mikro-orm/core";
import { AbstractSqlDriver } from "@mikro-orm/knex";
import { AgentEntity, AgentMinting, AgentRedemption } from "./entities/agent";
import { WalletAddress } from "./entities/wallet";
import { createOrm, CreateOrmOptions, ORM } from "./config/orm";
import { PostgreSqlDriver } from "@mikro-orm/postgresql";
import { getSecrets } from "./config/secrets";

/* istanbul ignore next */
const options: Options<AbstractSqlDriver | PostgreSqlDriver> = {
    entities: [WalletAddress, AgentEntity, AgentMinting, AgentRedemption],
    dbName: "fasset-bots.db",
    debug: false
};

export async function overrideAndCreateOrm(optionsOverride: CreateOrmOptions): Promise<ORM> {
    const secrets = getSecrets();
    const createOptions: CreateOrmOptions = { ...options, ...secrets.database, ...optionsOverride };
    return await createOrm(createOptions);
}

export default options;
