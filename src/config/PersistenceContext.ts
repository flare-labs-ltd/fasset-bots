import options from "../mikro-orm.config";
import { MikroORM } from '@mikro-orm/core';
import type { AbstractSqlDriver, SqlEntityManager } from '@mikro-orm/sqlite';

export class PersistenceContext {
    constructor(
        public readonly orm: MikroORM<AbstractSqlDriver>,
        public em: SqlEntityManager,
    ) { }
    
    static async create() {
        const orm = await MikroORM.init<AbstractSqlDriver>(options as any);
        return new PersistenceContext(orm, orm.em);
    }
    
    clone() {
        return new PersistenceContext(this.orm, this.orm.em);
    }
};
