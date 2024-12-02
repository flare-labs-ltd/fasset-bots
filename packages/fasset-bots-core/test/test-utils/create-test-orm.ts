import { copyFile } from "fs/promises";
import { CreateOrmOptions, ORM } from "../../src/config/orm";
import { overrideAndCreateOrm } from "../../src/mikro-orm.config";
import { simpleWalletEntities } from "@flarelabs/simple-wallet";
import { agentBotEntities, otherBotEntitites } from "../../src";

const testOptions: CreateOrmOptions = {
    entities: [...simpleWalletEntities, ...agentBotEntities, ...otherBotEntitites],
    type: "sqlite",
    dbName: "fasset-bots-test.db",
    debug: false,
    allowGlobalContext: true,
    schemaUpdate: "recreate",
    pool: {
        min: 0,
        max: 2,
    }
};

const ormInitOptions: WeakMap<ORM, CreateOrmOptions> = new WeakMap();
const ormCopies: WeakMap<ORM, ORM> = new WeakMap();

export function createTestOrmOptions(testOptionsOverride: Partial<CreateOrmOptions> = {}): CreateOrmOptions {
    return { ...testOptions, ...testOptionsOverride };
}

export async function createTestOrm(testOptionsOverride: Partial<CreateOrmOptions> = {}) {
    const options = createTestOrmOptions(testOptionsOverride);
    const orm = await overrideAndCreateOrm(options, undefined);
    ormInitOptions.set(orm, options);
    return orm;
}

export function isRegisteredORM(value: unknown): value is ORM {
    return ormInitOptions.has(value as ORM);
}

export async function copyORM(orm: ORM) {
    const options = ormInitOptions.get(orm)!;
    if (options.type !== 'sqlite' || options.dbName == null) {
        throw new Error("Only for SQLite");
    }
    // clear and close old (on first run, before any copy is made, close the original)
    const ormToClose = ormCopies.get(orm) ?? orm;
    await ormToClose.em.flush();
    ormToClose.em.clear();
    await ormToClose.close();
    // copy sqlite db file
    const dbName = options.dbName.replace(/\.db$/, `.copy.db`);
    await copyFile(options.dbName, dbName);
    // if ()
    return await overrideAndCreateOrm({ ...options, dbName, schemaUpdate: "none" }, undefined);
}
