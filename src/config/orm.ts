import { MikroORM, Options } from "@mikro-orm/core";
import { AbstractSqlDriver, SqlEntityManager } from "@mikro-orm/knex";

export type EM = SqlEntityManager;

export type ORM = MikroORM<AbstractSqlDriver>;

export type SchemaUpdate = 'safe' | 'full' | 'recreate';

export type CreateOrmOptions = Options<AbstractSqlDriver> & {
    schemaUpdate?: SchemaUpdate;
};

export async function createOrm(options: CreateOrmOptions): Promise<ORM> {
    const initOptions = { ...options };
    delete initOptions.schemaUpdate;    // delete extra options
    const orm = await MikroORM.init<AbstractSqlDriver>(initOptions);
    if (options.schemaUpdate) {
        await updateSchema(orm, options.schemaUpdate);
    }
    return orm;
}

export async function updateSchema(orm: ORM, update: SchemaUpdate) {
    const generator = orm.getSchemaGenerator();
    if (update == 'recreate') {
        await generator.dropSchema();
        await generator.updateSchema();
    } else if (update) {
        await generator.updateSchema({ safe: update === 'safe' });
    }
}
