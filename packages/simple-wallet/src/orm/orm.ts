import { FilterQuery, RequiredEntityData, SqlEntityManager } from "@mikro-orm/knex";
import { MikroORM, Options } from "@mikro-orm/sqlite";
import { TransactionEntity, TransactionStatus } from "../entity/transaction";
import BN from "bn.js";

export type EM = SqlEntityManager;

export type ORM = MikroORM;

export type SchemaUpdate = "none" | "safe" | "full" | "recreate";

export type CreateOrmOptions = Options & {
    schemaUpdate?: SchemaUpdate;
    dbName?: string;
};

export async function createOrm(options: CreateOrmOptions): Promise<ORM> {
    const initOptions = { ...options };
    delete initOptions.schemaUpdate; // delete extra options

    const orm = await MikroORM.init(initOptions);
    await updateSchema(orm, options.schemaUpdate); // updateSchema needs to run in order to create tables
    await orm.isConnected();
    return orm;
}

export async function updateSchema(orm: ORM, update: SchemaUpdate = "full"): Promise<void> {
    if (update === "none") return;
    const generator = orm.getSchemaGenerator();
    if (update && update == "recreate") {
        await generator.dropSchema();
        await generator.updateSchema();
    } else {
        await generator.updateSchema({ safe: update === "safe" });
    }
}

export async function createTransactionEntity(orm: ORM, transaction: any, source: string, destination: string, txHash:string, maxFee: BN | null = null, confirmations: number = 0): Promise<void> {
    orm.em.create(
        TransactionEntity,
        {
            source: source,
            destination: destination,
            transactionHash: txHash,
            status: TransactionStatus.TX_SENT,
            confirmations: confirmations,
            maxFee: maxFee,
            raw: Buffer.from(JSON.stringify(transaction))
        } as RequiredEntityData<TransactionEntity>,
    );
    await orm.em.flush();
}

export async function updateTransactionEntity(orm: ORM, txHash: string, modify: (agentEnt: TransactionEntity) => Promise<void>): Promise<void> {
    await orm.em.transactional(async (em) => {
        const agentEnt: TransactionEntity = await fetchTransactionEntity(orm, txHash);
        await modify(agentEnt);
        await em.persistAndFlush(agentEnt);
    });
}

export async function fetchTransactionEntity(orm: ORM, txHash: string): Promise<TransactionEntity> {
    return await orm.em.findOneOrFail(TransactionEntity, { transactionHash: txHash } as FilterQuery<TransactionEntity>, { refresh: true, populate: ['replaced_by'] });
}

export async function getReplacedTransactionHash(orm: ORM, transactionHash: string): Promise<string> {
    let txEnt = await fetchTransactionEntity(orm, transactionHash);
    let replaced = txEnt.replaced_by;
    while (replaced) {
       txEnt = await fetchTransactionEntity(orm, replaced.transactionHash);
       replaced = txEnt.replaced_by;
    }
    return txEnt.transactionHash;
 }