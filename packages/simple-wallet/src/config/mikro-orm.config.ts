import { TransactionEntity } from "../entity/transaction";
import { MikroORM, Options, SqliteDriver } from '@mikro-orm/sqlite';

/* istanbul ignore next */
const config: Options = {
    entities: [TransactionEntity],
    dbName: "simple-wallet.db",
    debug: false,
    driver: SqliteDriver,
};



export async function initializeMikroORM(): Promise<MikroORM> {
    const orm = await MikroORM.init(config); // Initialize MikroORM with the configuration
    await orm.getSchemaGenerator().ensureDatabase(); // Ensure that the database schema is created
    await orm.getSchemaGenerator().updateSchema();
    return orm;
}

export default config;