import { MikroORM, Options } from "@mikro-orm/core";
import { AbstractSqlDriver } from "@mikro-orm/sqlite";
import { SchemaUpdate } from "../../src/interfaces/IWalletTransaction";
import { simpleWalletEntities } from "../../src/entity";

export type ORM = MikroORM;

export type CreateOrmOptions = Options<AbstractSqlDriver> & {
    schemaUpdate?: SchemaUpdate;
    dbName?: string;
    type: string;
};

const config: CreateOrmOptions = {
    entities: simpleWalletEntities,
    debug: false,
    allowGlobalContext: true,
    dbName: "simple-wallet-test-db",
    schemaUpdate: "recreate",
    host: "localhost",
    port: 3306,
    user: "testwallet",
    password: "testwallet_password",
    type: "mysql"
};

export async function initializeTestMikroORM(): Promise<MikroORM> {
    const orm = await MikroORM.init(config);
    await orm.getSchemaGenerator().ensureDatabase();
    await orm.getSchemaGenerator().dropSchema();
    await orm.getSchemaGenerator().createSchema(); // recreate every time when testing
    return orm;
}

export async function initializeMainnetMikroORM(config: CreateOrmOptions): Promise<MikroORM> {
    const orm = await MikroORM.init(config);
    await orm.getSchemaGenerator().updateSchema();
    await orm.getSchemaGenerator().ensureDatabase();
    return orm;
}

export async function initializeTestMikroORMWithConfig(config: CreateOrmOptions): Promise<MikroORM> {
    const orm = await MikroORM.init(config);
    await orm.getSchemaGenerator().ensureDatabase();
    await orm.getSchemaGenerator().dropSchema();
    await orm.getSchemaGenerator().createSchema(); // recreate every time when testing
    return orm;
}

export default config;
