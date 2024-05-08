import { SqliteDriver , Options, MikroORM} from '@mikro-orm/sqlite';
import { Alert } from '../common/entities/AlertDB';

const config: Options = {
    dbName: 'agent-alerts.db',
    entities: [Alert],
    type: 'sqlite',
    driver: SqliteDriver,
    debug: true
};

export async function initializeMikroORM(): Promise<MikroORM> {
    const orm = await MikroORM.init(config); // Initialize MikroORM with the configuration
    await orm.getSchemaGenerator().ensureDatabase(); // Ensure that the database schema is created
    await orm.getSchemaGenerator().updateSchema();
    console.log('MikroORM initialized');
    return orm;
}

export default config;