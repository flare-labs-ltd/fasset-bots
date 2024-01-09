import { MikroORM, Options } from "@mikro-orm/core";
import { AbstractSqlDriver } from "@mikro-orm/knex";
import * as postgres from "@mikro-orm/postgresql";
import * as mysql from "@mikro-orm/mysql";
import * as sqlite from "@mikro-orm/sqlite";

export type EM = postgres.SqlEntityManager | mysql.SqlEntityManager | sqlite.SqlEntityManager;

export type ORM = MikroORM<AbstractSqlDriver | postgres.PostgreSqlDriver>;

export type SchemaUpdate = "safe" | "full" | "recreate";

export type DatabaseType = "mysql" | "sqlite" | "postgresql";

export type CreateOrmOptions = Options<AbstractSqlDriver | postgres.PostgreSqlDriver> & {
    schemaUpdate?: SchemaUpdate;
    dbName?: string;
    type: DatabaseType;
};

export async function createOrm(options: CreateOrmOptions): Promise<ORM> {
    const initOptions = { ...options };
    delete initOptions.schemaUpdate; // delete extra options

    const orm = await MikroORM.init(initOptions);
    await updateSchema(orm, options.schemaUpdate); // updateSchema needs to run in order to create tables
    await orm.isConnected();
    return orm;
}

export async function updateSchema(orm: ORM, update?: SchemaUpdate): Promise<void> {
    const generator = orm.getSchemaGenerator();
    if (update && update == "recreate") {
        await generator.dropSchema();
        await generator.updateSchema();
    } else {
        await generator.updateSchema({ safe: update === "safe" });
    }
}
