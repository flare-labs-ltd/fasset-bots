import { MikroORM, Options } from "@mikro-orm/core";
import { AbstractSqlDriver } from "@mikro-orm/sqlite";
import { TransactionEntity } from "../../src/entity/transaction";
import { UTXOEntity } from "../../src/entity/utxo";
import { WalletAddressEntity } from "../../src/entity/wallet";
import { SchemaUpdate } from "../../src/interfaces/IWalletTransaction";
import { MonitoringStateEntity } from "../../src";

export type ORM = MikroORM;

export type CreateOrmOptions = Options<AbstractSqlDriver> & {
    schemaUpdate?: SchemaUpdate;
    dbName?: string;
    type: string;
};
const config: CreateOrmOptions = {
    entities: [TransactionEntity, UTXOEntity, WalletAddressEntity, MonitoringStateEntity],
    debug: false,
    allowGlobalContext: true,
    dbName: "simple-wallet-test-db",
    schemaUpdate: "recreate",
    host: "localhost",
    port: 3306,
    user: "user",
    password: "user_password",
    type: "mysql"
};

export async function initializeTestMikroORM(): Promise<MikroORM> {
    const orm = await MikroORM.init(config);
    await orm.getSchemaGenerator().ensureDatabase();
    await orm.getSchemaGenerator().updateSchema();
    return orm;
}

export default config;
