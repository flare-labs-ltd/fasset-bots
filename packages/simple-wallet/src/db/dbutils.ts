import { RequiredEntityData, FilterQuery } from "@mikro-orm/core";
import BN from "bn.js";
import { ORM } from "../orm/mikro-orm.config";
import { toBN } from "../utils/bnutils";
import { ChainType } from "../utils/constants";
import { TransactionInfo } from "../interfaces/WalletTransactionInterface";
import { logger } from "../utils/logger";
import { WalletEntity } from "../entity/wallet";
import { TransactionEntity, TransactionStatus } from "../entity/transaction";
import { UTXOEntity, SpentHeightEnum } from "../entity/utxo";


// transaction operations
export async function createInitialTransactionEntity(
    orm: ORM,
    chainType: ChainType,
    source: string,
    destination: string,
    amountInDrops: BN | null,
    feeInDrops?: BN,
    note?: string,
    maxFee?: BN,
    sequence?: number,
    executeUntilBlock?: number,
    executeUntilTimestamp?: number
): Promise<TransactionEntity> {
    const ent = orm.em.create(
        TransactionEntity,
        {
            chainType,
            source,
            destination,
            status: TransactionStatus.TX_CREATED,
            maxFee: maxFee || null,
            executeUntilBlock: executeUntilBlock || null,
            executeUntilTimestamp: executeUntilTimestamp || null,
            reference: note || null,
            sequence: sequence || null,
            amount: amountInDrops,
            fee: feeInDrops || null
        } as RequiredEntityData<TransactionEntity>,
    );
    await orm.em.flush();
    return ent;
}

export async function updateTransactionEntity(orm: ORM, id: number, modify: (transactionEnt: TransactionEntity) => Promise<void>): Promise<void> {
    await orm.em.transactional(async (em) => {
        const transactionEnt: TransactionEntity = await fetchTransactionEntityById(orm, id);
        await modify(transactionEnt);
        await em.persistAndFlush(transactionEnt);
    });
}

export async function fetchTransactionEntityById(orm: ORM, id: number): Promise<TransactionEntity> {
    return await orm.em.findOneOrFail(TransactionEntity, { id } as FilterQuery<TransactionEntity>, { refresh: true, populate: ['replaced_by'] });
}

export async function updateTransactionEntityByHash(orm: ORM, txHash: string, modify: (transactionEnt: TransactionEntity) => Promise<void>): Promise<void> {
    await orm.em.transactional(async (em) => {
        const transactionEnt: TransactionEntity = await fetchTransactionEntityByHash(orm, txHash);
        await modify(transactionEnt);
        await em.persistAndFlush(transactionEnt);
    });
}

export async function fetchTransactionEntityByHash(orm: ORM, txHash: string): Promise<TransactionEntity> {
    return await orm.em.findOneOrFail(TransactionEntity, { transactionHash: txHash } as FilterQuery<TransactionEntity>, { refresh: true, populate: ['replaced_by'] });
}

export async function fetchTransactionEntities(orm: ORM, chainType: ChainType, status: TransactionStatus): Promise<TransactionEntity[]> {
    return await orm.em.find(TransactionEntity, { status, chainType } as FilterQuery<TransactionEntity>, { refresh: true, populate: ['replaced_by'], orderBy: { id: 'ASC' } });
}

// utxo operations
export async function createUTXOEntity(orm: ORM, source: string, txHash: string, position: number, value: BN, script: string, spentTxHash: string | null = null): Promise<void> {
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
        } catch (e) {
            await createUTXOEntity(orm, source, utxo.mintTxid, utxo.mintIndex, toBN(utxo.value), utxo.script);
        }

    }
}

// replaced transaction
export async function getReplacedTransactionByHash(orm: ORM, transactionHash: string): Promise<string> {

    let txEnt = await fetchTransactionEntityByHash(orm, transactionHash);
    let replaced = txEnt.replaced_by;
    while (replaced && replaced.transactionHash) {
        txEnt = await fetchTransactionEntityByHash(orm, replaced.transactionHash);
        replaced = txEnt.replaced_by;
    }
    return txEnt.transactionHash!;
}

export async function getReplacedTransactionById(orm: ORM, dbId: number): Promise<TransactionEntity> {
    let txEnt = await fetchTransactionEntityById(orm, dbId);
    let replaced = txEnt.replaced_by;
    while (replaced && replaced.transactionHash) {
        txEnt = await fetchTransactionEntityById(orm, replaced.id);
        replaced = txEnt.replaced_by;
    }
    return txEnt;
}

// get transaction info
export async function getTransactionInfoById(orm: ORM, dbId: number): Promise<TransactionInfo> {
    const txEntReplaced = await getReplacedTransactionById(orm, dbId);
    const txEntOriginal = await fetchTransactionEntityById(orm, dbId);
    return {
        dbId: dbId,
        transactionHash: txEntOriginal.transactionHash || null,
        status: txEntOriginal.status,
        replacedByDdId: dbId == txEntReplaced.id ? null : txEntReplaced.id
    };
}


//others
export async function handleMissingPrivateKey(orm: ORM, txId: number): Promise<void> {
    await failTransaction(orm, txId, `Cannot prepare transaction ${txId}. Missing private key.`);
}

export async function failTransaction(orm: ORM, txId: number, reason: string, error?: Error): Promise<void> {
    await updateTransactionEntity(orm, txId, async (txEnt) => {
        txEnt.status = TransactionStatus.TX_FAILED;
    });
    if (error) {
        logger.error(`Transaction ${txId} failed: ${reason}`, error);
        console.error(`Transaction ${txId} failed: ${reason}`, error);
    } else {
        logger.error(`Transaction ${txId} failed: ${reason}`);
        console.error(`Transaction ${txId} failed: ${reason}`);
    }
}

export async function processTransactions(orm: ORM, chainType: ChainType, status: TransactionStatus, processFunction: (txEnt: TransactionEntity) => Promise<void>): Promise<void> {
    const transactionEntities = await fetchTransactionEntities(orm, chainType, status);
    logger.info(`Fetching ${transactionEntities.length} transactions with status ${status}`);
    console.info(`Fetching ${transactionEntities.length} transactions with status ${status}`);
    for (const txEnt of transactionEntities) {
       try {
          await processFunction(txEnt);
       } catch (e) {
          logger.error(`Cannot process transaction ${txEnt.id}`, e);
          console.error(`Error while processing ${txEnt.id}`, e);
       }
    }
 }

export async function checkIfIsDeleting(orm: ORM, address: string): Promise<boolean> {
    const wa = await orm.em.findOne(WalletEntity, { address } as FilterQuery<WalletEntity>);
    if (wa && wa.isDeleting) {
        return true;
    }
    return false;
}

export async function setAccountIsDeleting(orm: ORM, address: string): Promise<void> {
    await orm.em.transactional(async (em) => {
        const wa = await orm.em.findOne(WalletEntity, { address } as FilterQuery<WalletEntity>);
        if (wa) {
            wa.isDeleting = true;
            await em.persistAndFlush(wa);
        }
    });
}