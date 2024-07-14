import { TransactionEntity } from "../entity/transaction";
import { MikroORM, Options, SqliteDriver } from '@mikro-orm/sqlite';
import { UTXOEntity } from "../entity/utxo";
import { WalletEntity } from "../entity/wallet";
import { ChainType } from "../utils/constants";

export type ORM = MikroORM;
const config: Options = {
    entities: [TransactionEntity, UTXOEntity, WalletEntity],
    debug: false,
    driver: SqliteDriver,
    allowGlobalContext: true,
    dbName: "simple-wallet.db"
};

export async function initializeMikroORM(): Promise<MikroORM> {
    const orm = await MikroORM.init(config);
    await orm.getSchemaGenerator().ensureDatabase();
    await orm.getSchemaGenerator().updateSchema();
    return orm;
}

export default config;
