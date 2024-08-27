import { Options } from "@mikro-orm/core";
import { AbstractSqlDriver } from "@mikro-orm/knex";
import { DatabaseAccount } from "./config/config-files/SecretsFile";
import { CreateOrmOptions, ORM, createOrm } from "./config/orm";
import { AgentEntity, AgentMinting, AgentRedemption, AgentUnderlyingPayment, AgentUpdateSetting, Event } from "./entities/agent";
import { MonitoringStateEntity, TransactionEntity, UTXOEntity, WalletAddressEntity } from "@flarelabs/simple-wallet";

/* istanbul ignore next */
const options: Options<AbstractSqlDriver> = {
    entities: [WalletAddressEntity, AgentEntity, AgentMinting, AgentRedemption, Event, AgentUnderlyingPayment, AgentUpdateSetting, UTXOEntity, TransactionEntity, MonitoringStateEntity],
    dbName: "fasset-bots.db",
    debug: false,
    migrations: {
        path: "./packages/fasset-bots-core/dist/src/migrations/",
        pathTs: "./packages/fasset-bots-core/src/migrations/"
    }
};

export async function overrideAndCreateOrm(optionsOverride: CreateOrmOptions, databaseAccount: DatabaseAccount | undefined, defaultOptions: Options<AbstractSqlDriver> = options): Promise<ORM> {
    const createOptions: CreateOrmOptions = { ...defaultOptions, ...databaseAccount, ...optionsOverride };
    return createOrm(createOptions);
}

export default options;
