import { EntityManager, FilterQuery, RequiredEntityData } from "@mikro-orm/core";
import BN from "bn.js";
import { toBN } from "../utils/bnutils";
import { ChainType } from "../utils/constants";
import { TransactionInfo } from "../interfaces/IWalletTransaction";
import { logger } from "../utils/logger";
import { WalletAddressEntity } from "../entity/wallet";
import { TransactionEntity, TransactionStatus } from "../entity/transaction";
import { SpentHeightEnum, UTXOEntity } from "../entity/utxo";
import { Transaction } from "bitcore-lib";
import { TransactionOutputEntity } from "../entity/transactionOutput";
import { MonitoringStateEntity } from "../entity/monitoring_state";
import Output = Transaction.Output;


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
    executeUntilTimestamp?: number,
    replacementFor?: TransactionEntity
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
            fee: feeInDrops || null,
            rbfReplacementFor: replacementFor || null,
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
    return await rootEm.findOneOrFail(TransactionEntity, { id } as FilterQuery<TransactionEntity>, {
        refresh: true,
        populate: ["replaced_by", "rbfReplacementFor", "utxos", "inputsAndOutputs"],
    });
}

export async function updateTransactionEntityByHash(rootEm: EntityManager, txHash: string, modify: (transactionEnt: TransactionEntity) => Promise<void>): Promise<void> {
    await rootEm.transactional(async (em) => {
        const transactionEnt: TransactionEntity = await fetchTransactionEntityByHash(rootEm, txHash);
        await modify(transactionEnt);
        await em.persistAndFlush(transactionEnt);
    });
}

export async function fetchTransactionEntityByHash(rootEm: EntityManager, txHash: string): Promise<TransactionEntity> {
    return await rootEm.findOneOrFail(TransactionEntity, { transactionHash: txHash } as FilterQuery<TransactionEntity>, {
        refresh: true,
        populate: ["replaced_by", "rbfReplacementFor", "utxos", "inputsAndOutputs"],
    });
}

export async function fetchTransactionEntities(rootEm: EntityManager, chainType: ChainType, status: TransactionStatus): Promise<TransactionEntity[]> {
    return await rootEm.find(TransactionEntity, {
        status,
        chainType,
    } as FilterQuery<TransactionEntity>, { refresh: true, populate: ["replaced_by", "rbfReplacementFor", "utxos", "inputsAndOutputs"], orderBy: { id: "ASC" } });
}

export async function createTransactionOutputEntities(rootEm: EntityManager, transaction: Transaction, txId: number): Promise<void> {
    const txEnt = await fetchTransactionEntityById(rootEm, txId);
    const outputEntities = transaction.outputs.map(((output, index) => transformOutputToTxOutputEntity(index, output, txEnt)));
    await rootEm.persistAndFlush(outputEntities);
}

function transformOutputToTxOutputEntity(vout: number, output: Output, transaction: TransactionEntity): TransactionOutputEntity {
    const entity = new TransactionOutputEntity();
    entity.transaction = transaction;
    entity.transactionHash = transaction.transactionHash!;
    entity.vout = vout;
    entity.amount = toBN(output.satoshis);
    entity.script = JSON.parse(JSON.stringify(output)).script;
    return entity;
}

export function transformUTXOEntToTxOutputEntity(utxo: UTXOEntity, transaction: TransactionEntity | null, isInput?: boolean): TransactionOutputEntity {
    const entity = new TransactionOutputEntity();

    if(transaction) {
        entity.transaction = transaction;
    }

    entity.transactionHash = utxo.mintTransactionHash;
    entity.vout = utxo.position;
    entity.amount = utxo.value;
    entity.script = utxo.script!;
    entity.isInput = isInput ?? false;
    return entity;
}

export function createTransactionOutputEntity(txEnt: TransactionEntity, txHash: string, amount: BN | string | number, vout: number | undefined, script: string, isInput?: boolean): TransactionOutputEntity {
    const entity = new TransactionOutputEntity();
    entity.transactionHash = txHash;
    entity.vout = vout;
    entity.amount = toBN(amount);
    entity.script = script;
    entity.transaction = txEnt;
    entity.isInput = isInput ?? false;
    return entity;
}

// utxo operations
export async function createUTXOEntity(rootEm: EntityManager, source: string, txHash: string, position: number, value: BN, script: string, spentTxHash: string | null = null, confirmed: boolean): Promise<void> {
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
            confirmed: confirmed,
        } as RequiredEntityData<UTXOEntity>,
    );
    await rootEm.flush();
}

export async function fetchUTXOEntity(rootEm: EntityManager, mintTxHash: string, position: number): Promise<UTXOEntity> {
    return await rootEm.findOneOrFail(UTXOEntity, {
        mintTransactionHash: mintTxHash,
        position: position,
    } as FilterQuery<UTXOEntity>, { refresh: true });
}

export async function updateUTXOEntity(rootEm: EntityManager, txHash: string, position: number, modify: (utxoEnt: UTXOEntity) => Promise<void>): Promise<void> {
    await rootEm.transactional(async (em) => {
        const utxoEnt: UTXOEntity = await fetchUTXOEntity(rootEm, txHash, position);
        await modify(utxoEnt);
        await em.persistAndFlush(utxoEnt);
    });
}

export async function fetchUnspentUTXOs(rootEm: EntityManager, source: string, onlyConfirmed?: boolean): Promise<UTXOEntity[]> {
    const res = await rootEm.find(UTXOEntity, {
        source: source,
        spentHeight: SpentHeightEnum.UNSPENT,
    } as FilterQuery<UTXOEntity>, { refresh: true, orderBy: { value: "desc", confirmed: "desc" } });
    return onlyConfirmed ? res.filter(t => t.confirmed) : res;
}

export async function fetchUTXOsByTxHash(rootEm: EntityManager, txHash: string): Promise<UTXOEntity[]> {
    return await rootEm.find(UTXOEntity, { mintTransactionHash: txHash } as FilterQuery<UTXOEntity>, { refresh: true });
}

export async function fetchUTXOs(rootEm: EntityManager, inputs: Transaction.Input[]): Promise<UTXOEntity[]> {
    return await rootEm.find(UTXOEntity, {
        $or: inputs.map(input => ({
            mint_transaction_hash: input.prevTxId.toString("hex"),
            position: input.outputIndex,
        })),
    });
}

export async function storeUTXOS(rootEm: EntityManager, source: string, mempoolUTXOs: any[]): Promise<void> {
    for (const utxo of mempoolUTXOs) {
        try {
            await fetchUTXOEntity(rootEm, utxo.mintTxid, utxo.mintIndex);
        } catch (e) {
            await createUTXOEntity(rootEm, source, utxo.mintTxid, utxo.mintIndex, toBN(utxo.value), utxo.script, null, utxo.confirmed);
        }
    }
}

export async function correctUTXOInconsistencies(rootEm: EntityManager, address: string, mempoolUTXOs: any[]): Promise<void> {
    await rootEm.transactional(async (em) => {
        const condition = mempoolUTXOs.map((utxo) => ({
            $not: {
                mintTransactionHash: { $like: utxo.mintTxid },
                position: utxo.mintIndex,
            },
        }));
        const utxoEnts = await em.find(UTXOEntity, {
            source: address,
            spentHeight: SpentHeightEnum.UNSPENT,
            $and: condition,
        }) as UTXOEntity[];

        utxoEnts.forEach(utxoEnt => {
            utxoEnt.spentHeight = SpentHeightEnum.SPENT;
        });

        if (utxoEnts.length > 0) {
            logger.info(`Fixed ${utxoEnts.length} UTXO inconsistencies`);
        }

        await em.persistAndFlush(utxoEnts);
    });
}

export async function removeUTXOsAndAddReplacement(rootEm: EntityManager, txId: number, replacementTx: TransactionEntity): Promise<void> {
    await rootEm.transactional(async (em) => {
        const utxos = await em.find(UTXOEntity, { transaction: { id: txId } });
        utxos.forEach(utxo => {
            utxo.spentHeight = SpentHeightEnum.UNSPENT;
            utxo.transaction = undefined;
        });
        await em.persistAndFlush(utxos);
        const txEnt = await fetchTransactionEntityById(em, txId);
        txEnt.status = TransactionStatus.TX_REPLACED;
        txEnt.replaced_by = replacementTx;
    });
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
        replacedByDdId: dbId == txEntReplaced.id ? null : txEntReplaced.id,
    };
}


//others
export async function handleMissingPrivateKey(rootEm: EntityManager, txId: number): Promise<void> {
    await failTransaction(rootEm, txId, `Cannot prepare transaction ${txId}. Missing private key.`);
}

export async function failTransaction(rootEm: EntityManager, txId: number, reason: string, error?: Error): Promise<void> {
    await updateTransactionEntity(rootEm, txId, async (txEnt) => {
        txEnt.status = TransactionStatus.TX_FAILED;
        txEnt.reachedFinalStatusInTimestamp = new Date();
    });
    if (error) {
        logger.error(`Transaction ${txId} failed: ${reason}`, error);
    } else {
        logger.error(`Transaction ${txId} failed: ${reason}`);
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

// locking
export async function fetchMonitoringState(rootEm: EntityManager, chainType: string): Promise<MonitoringStateEntity | null> {
    return await rootEm.findOne(MonitoringStateEntity, { chainType } as FilterQuery<MonitoringStateEntity>, { refresh: true });
}


export async function updateMonitoringState(rootEm: EntityManager, chainType: string, modify: (stateEnt: MonitoringStateEntity) => Promise<void>): Promise<void> {
    await rootEm.transactional(async (em) => {
        const stateEnt = await fetchMonitoringState(rootEm, chainType);
        if (!stateEnt) return;
        await modify(stateEnt);
        await em.persistAndFlush(stateEnt);
    });
}