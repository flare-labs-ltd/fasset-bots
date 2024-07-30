import { MikroORM, Options } from "@mikro-orm/core";
import { AbstractSqlDriver, SqliteDriver } from "@mikro-orm/sqlite";
import { TransactionEntity } from "../../src/entity/transaction";
import { UTXOEntity } from "../../src/entity/utxo";
import { WalletAddressEntity } from "../../src/entity/wallet";
import { SchemaUpdate } from "../../src/interfaces/WalletTransactionInterface";
import { MonitoringStateEntity } from "../../src";

export type ORM = MikroORM;

export type CreateOrmOptions = Options<AbstractSqlDriver> & {
    schemaUpdate?: SchemaUpdate;
    dbName?: string;
    type: "sqlite";
};
const config: CreateOrmOptions = {
    entities: [TransactionEntity, UTXOEntity, WalletAddressEntity, MonitoringStateEntity],
    debug: false,
    driver: SqliteDriver,
    allowGlobalContext: true,
    dbName: "simple-wallet-test.db",
    schemaUpdate: "recreate",
    type: "sqlite"
};

export async function initializeTestMikroORM(): Promise<MikroORM> {
    const orm = await MikroORM.init(config);
    await orm.getSchemaGenerator().ensureDatabase();
    await orm.getSchemaGenerator().updateSchema();
    return orm;
}

export default config;
