import { Options } from "@mikro-orm/core";
import { AbstractSqlDriver } from "@mikro-orm/knex";
import { DatabaseAccount } from "./config/config-files/SecretsFile";
import { CreateOrmOptions, ORM, createOrm } from "./config/orm";
import { AgentEntity, AgentMinting, AgentRedemption, AgentUnderlyingPayment, Event } from "./entities/agent";
import { WalletAddress } from "./entities/wallet";

/* istanbul ignore next */
const options: Options<AbstractSqlDriver> = {
    entities: [WalletAddress, AgentEntity, AgentMinting, AgentRedemption, Event, AgentUnderlyingPayment],
    dbName: "fasset-bots.db",
    debug: false
};

export async function overrideAndCreateOrm(optionsOverride: CreateOrmOptions, databaseAccount: DatabaseAccount | undefined): Promise<ORM> {
    const createOptions: CreateOrmOptions = { ...options, ...databaseAccount, ...optionsOverride };
    return createOrm(createOptions);
}

export default options;
