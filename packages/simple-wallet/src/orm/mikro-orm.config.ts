import { TransactionEntity } from "../entity/transaction";
import { MikroORM, Options, SqliteDriver } from '@mikro-orm/sqlite';

/* istanbul ignore next */
const config: Options = {
    entities: [TransactionEntity],
    dbName: "simple-wallet.db",
    debug: false,
    driver: SqliteDriver,
    allowGlobalContext: true
};

export async function initializeMikroORM(): Promise<MikroORM> {
    const orm = await MikroORM.init(config);
    await orm.getSchemaGenerator().ensureDatabase();
    await orm.getSchemaGenerator().updateSchema();
    return orm;
}

export default config;