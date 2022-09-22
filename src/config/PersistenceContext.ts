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
        //https://stackoverflow.com/questions/71117269/validation-error-using-global-entity-manager-instance-methods-for-context-speci
        const emFork = orm.em.fork();
        return new PersistenceContext(orm, emFork);
    }
    
    clone() {
        return new PersistenceContext(this.orm, this.em);
    }
};
