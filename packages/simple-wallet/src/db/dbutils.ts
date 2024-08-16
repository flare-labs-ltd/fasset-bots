import { RequiredEntityData, FilterQuery, EntityManager } from "@mikro-orm/core";
import BN from "bn.js";
import { toBN } from "../utils/bnutils";
import { ChainType } from "../utils/constants";
import { TransactionInfo } from "../interfaces/WalletTransactionInterface";
import { logger } from "../utils/logger";
import { WalletAddressEntity } from "../entity/wallet";
import { TransactionEntity, TransactionStatus } from "../entity/transaction";
import { UTXOEntity, SpentHeightEnum } from "../entity/utxo";


// transaction operations
export async function createInitialTransactionEntity(
    rootEm: EntityManager,
    chainType: ChainType,
    source: string,
    destination: string,
    amountInDrops: BN | null,
    feeInDrops?: BN,
    note?: string,
    maxFee?: BN,
    executeUntilBlock?: number,
    executeUntilTimestamp?: number
): Promise<TransactionEntity> {
    const ent = rootEm.create(
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
            amount: amountInDrops,
            fee: feeInDrops || null
        } as RequiredEntityData<TransactionEntity>,
    );
    await rootEm.flush();
    return ent;
}

export async function updateTransactionEntity(rootEm: EntityManager, id: number, modify: (transactionEnt: TransactionEntity) => Promise<void>): Promise<void> {
    await rootEm.transactional(async (em) => {
        const transactionEnt: TransactionEntity = await fetchTransactionEntityById(rootEm, id);
        await modify(transactionEnt);
        await em.persistAndFlush(transactionEnt);
    });
}

export async function fetchTransactionEntityById(rootEm: EntityManager, id: number): Promise<TransactionEntity> {
    return await rootEm.findOneOrFail(TransactionEntity, { id } as FilterQuery<TransactionEntity>, { refresh: true, populate: ['replaced_by'] });
}

export async function updateTransactionEntityByHash(rootEm: EntityManager, txHash: string, modify: (transactionEnt: TransactionEntity) => Promise<void>): Promise<void> {
    await rootEm.transactional(async (em) => {
        const transactionEnt: TransactionEntity = await fetchTransactionEntityByHash(rootEm, txHash);
        await modify(transactionEnt);
        await em.persistAndFlush(transactionEnt);
    });
}

export async function fetchTransactionEntityByHash(rootEm: EntityManager, txHash: string): Promise<TransactionEntity> {
    return await rootEm.findOneOrFail(TransactionEntity, { transactionHash: txHash } as FilterQuery<TransactionEntity>, { refresh: true, populate: ['replaced_by'] });
}

export async function fetchTransactionEntities(rootEm: EntityManager, chainType: ChainType, status: TransactionStatus): Promise<TransactionEntity[]> {
    return await rootEm.find(TransactionEntity, { status, chainType } as FilterQuery<TransactionEntity>, { refresh: true, populate: ['replaced_by'], orderBy: { id: 'ASC' } });
}

// utxo operations
export async function createUTXOEntity(rootEm: EntityManager, source: string, txHash: string, position: number, value: BN, script: string, spentTxHash: string | null = null): Promise<void> {
    rootEm.create(
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
    await rootEm.flush();
}

export async function fetchUTXOEntity(rootEm: EntityManager, mintTxHash: string, position: number): Promise<UTXOEntity> {
    return await rootEm.findOneOrFail(UTXOEntity, { mintTransactionHash: mintTxHash, position: position } as FilterQuery<UTXOEntity>, { refresh: true });
}

export async function updateUTXOEntity(rootEm: EntityManager, txHash: string, position: number, modify: (utxoEnt: UTXOEntity) => Promise<void>): Promise<void> {
    await rootEm.transactional(async (em) => {
        const utxoEnt: UTXOEntity = await fetchUTXOEntity(rootEm, txHash, position);
        await modify(utxoEnt);
        await em.persistAndFlush(utxoEnt);
    });
}

export async function fetchUnspentUTXOs(rootEm: EntityManager, source: string): Promise<UTXOEntity[]> {
    return await rootEm.find(UTXOEntity, { source: source, spentHeight: SpentHeightEnum.UNSPENT } as FilterQuery<UTXOEntity>, { refresh: true });
}

export async function fetchUTXOsByTxHash(rootEm: EntityManager, txHash: string): Promise<UTXOEntity[]> {
    return await rootEm.find(UTXOEntity, { mintTransactionHash: txHash } as FilterQuery<UTXOEntity>, { refresh: true });
}

export async function storeUTXOS(rootEm: EntityManager, source: string, mempoolUTXOs: any[]): Promise<void> {
    for (const utxo of mempoolUTXOs) {
        try {
            await fetchUTXOEntity(rootEm, utxo.mintTxid, utxo.mintIndex);
        } catch (e) {
            await createUTXOEntity(rootEm, source, utxo.mintTxid, utxo.mintIndex, toBN(utxo.value), utxo.script);
        }

    }
}

// replaced transaction
export async function getReplacedTransactionByHash(rootEm: EntityManager, transactionHash: string): Promise<string> {

    let txEnt = await fetchTransactionEntityByHash(rootEm, transactionHash);
    let replaced = txEnt.replaced_by;
    while (replaced && replaced.transactionHash) {
        txEnt = await fetchTransactionEntityByHash(rootEm, replaced.transactionHash);
        replaced = txEnt.replaced_by;
    }
    return txEnt.transactionHash!;
}

export async function getReplacedTransactionById(rootEm: EntityManager, dbId: number): Promise<TransactionEntity> {
    let txEnt = await fetchTransactionEntityById(rootEm, dbId);
    let replaced = txEnt.replaced_by;
    while (replaced && replaced.transactionHash) {
        txEnt = await fetchTransactionEntityById(rootEm, replaced.id);
        replaced = txEnt.replaced_by;
    }
    return txEnt;
}

// get transaction info
export async function getTransactionInfoById(rootEm: EntityManager, dbId: number): Promise<TransactionInfo> {
    const txEntReplaced = await getReplacedTransactionById(rootEm, dbId);
    const txEntOriginal = await fetchTransactionEntityById(rootEm, dbId);
    return {
        dbId: dbId,
        transactionHash: txEntOriginal.transactionHash || null,
        status: txEntOriginal.status,
        replacedByDdId: dbId == txEntReplaced.id ? null : txEntReplaced.id
    };
}


//others
export async function handleMissingPrivateKey(rootEm: EntityManager, txId: number): Promise<void> {
    await failTransaction(rootEm, txId, `Cannot prepare transaction ${txId}. Missing private key.`);
}

export async function failTransaction(rootEm: EntityManager, txId: number, reason: string, error?: Error): Promise<void> {
    await updateTransactionEntity(rootEm, txId, async (txEnt) => {
        txEnt.status = TransactionStatus.TX_FAILED;
        txEnt.reachedFinalStatusInTimestamp = new Date().getTime();
    });
    if (error) {
        logger.error(`Transaction ${txId} failed: ${reason}`, error);
        console.error(`Transaction ${txId} failed: ${reason}`, error);
    } else {
        logger.error(`Transaction ${txId} failed: ${reason}`);
        console.error(`Transaction ${txId} failed: ${reason}`);
    }
}

export async function processTransactions(rootEm: EntityManager, chainType: ChainType, status: TransactionStatus, processFunction: (txEnt: TransactionEntity) => Promise<void>): Promise<void> {
    const transactionEntities = await fetchTransactionEntities(rootEm, chainType, status);
    logger.info(`Fetching ${transactionEntities.length} transactions with status ${status}`);
    for (const txEnt of transactionEntities) {
       try {
          await processFunction(txEnt);
       } catch (e) {
          logger.error(`Cannot process transaction ${txEnt.id}`, e);
          console.error(`Error while processing ${txEnt.id}`, e);
       }
    }
 }

export async function checkIfIsDeleting(rootEm: EntityManager, address: string): Promise<boolean> {
    const wa = await rootEm.findOne(WalletAddressEntity, { address } as FilterQuery<WalletAddressEntity>);
    if (wa && wa.isDeleting) {
        return true;
    }
    return false;
}

export async function setAccountIsDeleting(rootEm: EntityManager, address: string): Promise<void> {
    await rootEm.transactional(async (em) => {
        const wa = await rootEm.findOne(WalletAddressEntity, { address } as FilterQuery<WalletAddressEntity>);
        if (wa) {
            wa.isDeleting = true;
            await em.persistAndFlush(wa);
        }
    });
}