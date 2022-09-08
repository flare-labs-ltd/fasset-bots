import { MikroORM } from '@mikro-orm/core';
import type { SqlEntityManager, SqliteDriver } from '@mikro-orm/sqlite';
import { mkdirSync } from 'fs';
import { programConfig } from './config';

export let DI!: {
    orm: MikroORM;
    em: SqlEntityManager;
    config: typeof programConfig;
};

const main = async () => {
    const orm = await MikroORM.init<SqliteDriver>();
    const em = orm.em.fork();
    mkdirSync(programConfig.dbPath);
    mkdirSync(programConfig.walletsPath);
    DI = { orm, em, config: programConfig };
}

main().catch((error) => {
    console.error(error);
}).finally(() => {
    process.exit(0);
})
