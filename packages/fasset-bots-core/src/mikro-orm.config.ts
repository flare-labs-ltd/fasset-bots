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
    debug: false
};

export const simpleWalletOptions: Options<AbstractSqlDriver> = {// for user or cli
    entities: [WalletAddressEntity, UTXOEntity, TransactionEntity, MonitoringStateEntity],
    type: "sqlite",
    dbName: "simple-wallet.db",
    debug: false,
    allowGlobalContext: true,
};

export async function overrideAndCreateOrm(optionsOverride: CreateOrmOptions, databaseAccount: DatabaseAccount | undefined, defaultOptions: Options<AbstractSqlDriver> = options): Promise<ORM> {
    const createOptions: CreateOrmOptions = { ...defaultOptions, ...databaseAccount, ...optionsOverride };
    return createOrm(createOptions);
}

export default options;
