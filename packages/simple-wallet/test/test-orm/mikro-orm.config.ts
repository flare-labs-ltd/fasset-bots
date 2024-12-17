import { MikroORM, Options } from "@mikro-orm/core";
import { AbstractSqlDriver } from "@mikro-orm/sqlite";
import { TransactionEntity } from "../../src/entity/transaction";
import { WalletAddressEntity } from "../../src/entity/wallet";
import { SchemaUpdate } from "../../src/interfaces/IWalletTransaction";
import { MonitoringStateEntity } from "../../src/entity/monitoringState";
import { HistoryItem } from "../../src/entity/historyItem";
import { TransactionInputEntity } from "../../src/entity/transactionInput";
import { TransactionOutputEntity } from "../../src/entity/transactionOutput";

export type ORM = MikroORM;

export type CreateOrmOptions = Options<AbstractSqlDriver> & {
    schemaUpdate?: SchemaUpdate;
    dbName?: string;
    type: string;
};

const config: CreateOrmOptions = {
    entities: [TransactionEntity, WalletAddressEntity, MonitoringStateEntity, HistoryItem],
    debug: false,
    allowGlobalContext: true,
    dbName: "simple-wallet-test-db",
    schemaUpdate: "recreate",
    host: "localhost",
    port: 3306,
    user: "testwallet",
    password: "testwallet_password",
    type: "mysql"
};

export async function initializeTestMikroORM(customConfig?: CreateOrmOptions): Promise<MikroORM> {
    const configOptions = customConfig ?? config;
    const orm = await MikroORM.init(configOptions);
    await orm.getSchemaGenerator().ensureDatabase();
    await orm.getSchemaGenerator().dropSchema();
    await orm.getSchemaGenerator().createSchema(); // recreate every time when testing
    return orm;
}

export async function initializeMainnetMikroORM(config: CreateOrmOptions): Promise<MikroORM> {
    const orm = await MikroORM.init(config);
    await orm.getSchemaGenerator().updateSchema();
    await orm.getSchemaGenerator().ensureDatabase();
    return orm;
}

export default config;
