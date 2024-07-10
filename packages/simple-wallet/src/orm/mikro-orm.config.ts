import { TransactionEntity } from "../entity/transaction";
import { MikroORM, Options, SqliteDriver } from '@mikro-orm/sqlite';
import { UTXOEntity } from "../entity/utxo";

export type ORM = MikroORM;

const config: Options = {
    entities: [TransactionEntity, UTXOEntity],
    debug: false,
    driver: SqliteDriver,
    allowGlobalContext: true
};

export async function initializeMikroORM(dbName: string): Promise<MikroORM> {
    const orm = await MikroORM.init({dbName, ... config });
    await orm.getSchemaGenerator().ensureDatabase();
    await orm.getSchemaGenerator().updateSchema();
    return orm;
}

export default config;