import { RequiredEntityData, FilterQuery } from "@mikro-orm/core";
import BN from "bn.js";
import { TransactionEntity, TransactionStatus } from "../entity/transaction";
import { ORM } from "../orm/mikro-orm.config";
import { SpentHeightEnum, UTXOEntity } from "../entity/utxo";
import { toBN } from "./bnutils";

export async function createTransactionEntity(orm: ORM, transaction: any, source: string, destination: string, txHash:string, maxFee: BN | null = null, executeUntilBlock: number | null = null, confirmations: number = 0): Promise<void> {
    orm.em.create(
        TransactionEntity,
        {
            source: source,
            destination: destination,
            transactionHash: txHash,
            status: TransactionStatus.TX_SENT,
            confirmations: confirmations,
            maxFee: maxFee,
            executeUntilBlock: executeUntilBlock,
            raw: Buffer.from(JSON.stringify(transaction))
        } as RequiredEntityData<TransactionEntity>,
    );
    await orm.em.flush();
}

export async function updateTransactionEntity(orm: ORM, txHash: string, modify: (transactionEnt: TransactionEntity) => Promise<void>): Promise<void> {
    await orm.em.transactional(async (em) => {
        const transactionEnt: TransactionEntity = await fetchTransactionEntity(orm, txHash);
        await modify(transactionEnt);
        await em.persistAndFlush(transactionEnt);
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

 export async function createUTXOEntity(orm: ORM, source: string, txHash:string, position: number, value: BN, script: string, spentTxHash: string | null = null): Promise<void> {
    orm.em.create(
        UTXOEntity,
        {
            source: source,
            mintTransactionHash: txHash,
            spentHeight: SpentHeightEnum.UNSPENT,
            position: position,
            value: value,
            script: script,
            spentTransactionHash: spentTxHash,
        } as RequiredEntityData<UTXOEntity>,
    );
    await orm.em.flush();
}

export async function fetchUTXOEntity(orm: ORM, mintTxHash: string, position: number): Promise<UTXOEntity> {
    return await orm.em.findOneOrFail(UTXOEntity, { mintTransactionHash: mintTxHash, position: position } as FilterQuery<UTXOEntity>, { refresh: true });
}

export async function updateUTXOEntity(orm: ORM, txHash: string, position: number, modify: (utxoEnt: UTXOEntity) => Promise<void>): Promise<void> {
    await orm.em.transactional(async (em) => {
        const utxoEnt: UTXOEntity = await fetchUTXOEntity(orm, txHash, position);
        await modify(utxoEnt);
        await em.persistAndFlush(utxoEnt);
    });
}

export async function fetchUnspentUTXOs(orm: ORM, source: string): Promise<UTXOEntity[]> {
    return await orm.em.find(UTXOEntity, { source: source, spentHeight: SpentHeightEnum.UNSPENT } as FilterQuery<UTXOEntity>, { refresh: true });
}

export async function fetchUTXOsByTxHash(orm: ORM, txHash: string): Promise<UTXOEntity[]> {
    return await orm.em.find(UTXOEntity, { mintTransactionHash: txHash } as FilterQuery<UTXOEntity>, { refresh: true });
}

export async function storeUTXOS(orm: ORM, source: string, mempoolUTXOs: any[]): Promise<void> {
    for (const utxo of mempoolUTXOs) {
        try {
            await fetchUTXOEntity(orm, utxo.mintTxid, utxo.mintIndex);
        } catch(e) {
            await createUTXOEntity(orm, source, utxo.mintTxid, utxo.mintIndex, toBN(utxo.value), utxo.script);
        }

    }
}