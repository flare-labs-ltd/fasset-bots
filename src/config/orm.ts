import { MikroORM, Options } from "@mikro-orm/core";
import { AbstractSqlDriver, SqlEntityManager } from "@mikro-orm/knex";

export type EM = SqlEntityManager;

export type ORM = MikroORM<AbstractSqlDriver>;

export type SchemaUpdate = 'safe' | 'full' | 'recreate';

export type CreateOrmOptions = Options<AbstractSqlDriver> & {
    schemaUpdate?: SchemaUpdate;
    dbName?: string;
};

export async function createOrm(options: CreateOrmOptions): Promise<ORM> {
    const initOptions = { ...options };
    delete initOptions.schemaUpdate;    // delete extra options
    const orm = await MikroORM.init<AbstractSqlDriver>(initOptions);
    await updateSchema(orm, options.schemaUpdate); // updateSchema needs to run in order to create tables
    return orm;
}

export async function updateSchema(orm: ORM, update?: SchemaUpdate): Promise<void> {
    const generator = orm.getSchemaGenerator();
    if (update && update == 'recreate') {
        await generator.dropSchema();
        await generator.updateSchema();
    } else {
        await generator.updateSchema({ safe: update === 'safe' });
    }
}
