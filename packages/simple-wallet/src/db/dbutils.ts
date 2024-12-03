import { EntityManager, FilterQuery, RequiredEntityData, TransactionOptions } from "@mikro-orm/core";
import { Transaction } from "bitcore-lib";
import BN from "bn.js";
import { TransactionEntity, TransactionStatus } from "../entity/transaction";
import { TransactionInputEntity } from "../entity/transactionInput";
import { TransactionOutputEntity } from "../entity/transactionOutput";
import { WalletAddressEntity } from "../entity/wallet";
import { MempoolUTXO, UTXORawTransactionOutput } from "../interfaces/IBlockchainAPI";
import { TransactionInfo } from "../interfaces/IWalletTransaction";
import { toBN } from "../utils/bnutils";
import { ChainType } from "../utils/constants";
import { logger } from "../utils/logger";
import { getCurrentTimestampInSeconds, updateErrorWithFullStackTrace } from "../utils/utils";
import Output = Transaction.Output;
import { errorMessage } from "../utils/axios-utils";
import { MonitoringStateEntity } from "../entity/monitoringState";

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
    executeUntilTimestamp?: BN,
    replacementFor?: TransactionEntity,
    feeSource?: string,
    maxPaymentForFeeSource?: BN
): Promise<TransactionEntity> {
    logger.info(`Creating transaction ${source}, ${destination}, ${amountInDrops};${replacementFor ? ` replacing ${replacementFor.id} (${replacementFor.transactionHash}).` : ""}`);
    return await transactional(rootEm, async (em) => {
        const ent = em.create(TransactionEntity, {
            chainType,
            source,
            destination,
            status: TransactionStatus.TX_CREATED,
            maxFee: maxFee ?? null,
            executeUntilBlock: executeUntilBlock ?? null,
            executeUntilTimestamp: executeUntilTimestamp ?? null,
            reference: note ?? null,
            amount: amountInDrops,
            fee: feeInDrops ?? null,
            rbfReplacementFor: replacementFor ?? null,
            feeSource: feeSource ?? null,
            maxPaymentForFeeSource: maxPaymentForFeeSource ?? null
        } as RequiredEntityData<TransactionEntity>);
        await em.flush();
        logger.info(`Created transaction ${ent.id}.`);
        return ent;
    });
}

export async function updateTransactionEntity(rootEm: EntityManager, id: number, modify: (transactionEnt: TransactionEntity) => void): Promise<void> {
    await transactional(rootEm, async (em) => {
        const transactionEnt: TransactionEntity = await fetchTransactionEntityById(em, id);
        modify(transactionEnt);
        await em.persistAndFlush(transactionEnt);
    });
}

export async function fetchTransactionEntityById(rootEm: EntityManager, id: number): Promise<TransactionEntity> {
    return await rootEm.findOneOrFail(TransactionEntity, { id }, {
        refresh: true,
        populate: ["replaced_by", "rbfReplacementFor", "inputs", "outputs", "ancestor", "ancestor.replaced_by"],
    });
}

export async function fetchTransactionEntities(rootEm: EntityManager, chainType: ChainType, statuses: TransactionStatus[]): Promise<TransactionEntity[]> {
    return await rootEm.find(
        TransactionEntity,
        {
            status: { $in: statuses },
            chainType,
        },
        {
            refresh: true,
            populate: ["replaced_by", "rbfReplacementFor", "inputs", "outputs", "ancestor", "ancestor.replaced_by"],
            orderBy: { id: "ASC" },
        }
    );
}

export function resetTransactionEntity(txEnt: TransactionEntity) {
    txEnt.status = TransactionStatus.TX_CREATED;
    txEnt.inputs.removeAll();
    txEnt.outputs.removeAll();
    txEnt.raw = "";
    txEnt.transactionHash = "";
    txEnt.fee = undefined;
    txEnt.size = undefined;
    txEnt.ancestor = null;
    txEnt.replaced_by = null;
    txEnt.rbfReplacementFor = null;
}

export async function createTransactionOutputEntities(rootEm: EntityManager, transaction: Transaction, txId: number) {
    const txEnt = await fetchTransactionEntityById(rootEm, txId);
    return transaction.outputs.map((output, index) => transformOutputToTxOutputEntity(index, output, txEnt));
}

function transformOutputToTxOutputEntity(vout: number, output: Output, transaction: TransactionEntity): TransactionOutputEntity {
    const parsedOutput = JSON.parse(JSON.stringify(output)) as UTXORawTransactionOutput;

    /* istanbul ignore next */
    return createTransactionOutputEntity(
        transaction,
        transaction.transactionHash ?? "",
        toBN(output.satoshis),
        vout,
        parsedOutput.script ?? ""
    );
}

export function transformUTXOToTxInputEntity(utxo: MempoolUTXO, transaction: TransactionEntity): TransactionInputEntity {
    /* istanbul ignore next */
    return createTransactionInputEntity(transaction, utxo.transactionHash, utxo.value, utxo.position, utxo.script ?? "");
}

export function createTransactionOutputEntity(
    txEnt: TransactionEntity,
    txHash: string,
    amount: BN | string | number,
    vout: number,
    script: string
): TransactionOutputEntity {
    const entity = new TransactionOutputEntity();
    entity.transactionHash = txHash;
    entity.vout = vout;
    entity.amount = toBN(amount);
    entity.script = script;
    entity.transaction = txEnt;
    return entity;
}

export function createTransactionInputEntity(
    txEnt: TransactionEntity,
    txHash: string,
    amount: BN | string | number,
    vout: number,
    script: string
): TransactionOutputEntity {
    const entity = new TransactionInputEntity();
    entity.transactionHash = txHash;
    entity.vout = vout;
    entity.amount = toBN(amount);
    entity.script = script;
    entity.transaction = txEnt;
    return entity;
}

// replaced transaction
export async function getReplacedTransactionById(rootEm: EntityManager, dbId: number): Promise<TransactionEntity> {
    let txEnt = await fetchTransactionEntityById(rootEm, dbId);
    let replaced = txEnt.replaced_by;
    while (replaced) {
        txEnt = await fetchTransactionEntityById(rootEm, replaced.id);
        replaced = txEnt.replaced_by;
    }
    return txEnt;
}

// get transaction info
export async function getTransactionInfoById(rootEm: EntityManager, dbId: number): Promise<TransactionInfo> {
    const txEntOriginal = await fetchTransactionEntityById(rootEm, dbId);
    const txEntReplaced = (txEntOriginal.replaced_by)
        ? await getReplacedTransactionById(rootEm, txEntOriginal.replaced_by.id)
        : null;
    return {
        dbId: dbId,
        transactionHash: txEntOriginal.transactionHash ?? null,
        status: txEntOriginal.status,
        replacedByDdId: txEntReplaced?.id ?? null,
        replacedByHash: txEntReplaced?.transactionHash ?? null,
        replacedByStatus: txEntReplaced?.status ?? null,
    };
}

export async function findTransactionsWithStatuses(rootEm: EntityManager, chainType: ChainType, statuses: TransactionStatus[], source: string): Promise<TransactionEntity[]> {
    return await rootEm.find(TransactionEntity, { status: {$in: statuses}, chainType, source });
}

//others
export async function handleMissingPrivateKey(rootEm: EntityManager, txId: number, failedInFunction: string): Promise<void> {
    await failTransaction(rootEm, txId, `${failedInFunction}: Cannot prepare transaction ${txId}. Missing private key.`);
}

export async function handleNoTimeToSubmitLeft(
    rootEm: EntityManager,
    txId: number,
    currentLedger: number,
    executionBlockOffset: number,
    failedInFunction: string,
    executeUntilBlock?: number,
    executeUntilTimestamp?: string
): Promise<void> {
    const currentTimestamp = toBN(getCurrentTimestampInSeconds());
    await failTransaction(
        rootEm,
        txId,
        `${failedInFunction}: Transaction ${txId} has no time left to be submitted: currentBlockHeight: ${currentLedger}, executeUntilBlock: ${executeUntilBlock}, offset ${executionBlockOffset}.
              Current timestamp ${currentTimestamp.toString()} >= execute until timestamp ${executeUntilTimestamp}.`
    );
}

export async function failDueToNoTimeToSubmit(rootEm: EntityManager, medianTime: BN | null, currentBlockNumber: number, txEnt: TransactionEntity, fnText: string){
    await failTransaction(
        rootEm,
        txEnt.id,
        `${fnText}: No time to submit ${txEnt.id}: Current block ${currentBlockNumber} >= last block ${txEnt.executeUntilBlock}${medianTime ? ` AND median block time ${medianTime.toString()} >= execute until ${txEnt.executeUntilTimestamp?.toString()}` : ''}`
    );
}

export async function failTransaction(rootEm: EntityManager, txId: number, reason: string, error?: Error): Promise<void> {
    await updateTransactionEntity(rootEm, txId, (txEnt) => {
        txEnt.status = TransactionStatus.TX_FAILED;
        txEnt.reachedFinalStatusInTimestamp = toBN(getCurrentTimestampInSeconds());
        txEnt.serverSubmitResponse = JSON.stringify(reason);
    });
    /* istanbul ignore next */
    if (error) {
        logger.error(`Transaction ${txId} failed: ${reason}: ${errorMessage(error)}`);
    } else {
        logger.error(`Transaction ${txId} failed: ${reason}`);
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
    logger.info(`Settings ${address} to be deleted.`);
    await transactional(rootEm, async (em) => {
        const wa = await em.findOne(WalletAddressEntity, { address } as FilterQuery<WalletAddressEntity>);
        /* istanbul ignore else */
        if (wa) {
            wa.isDeleting = true;
            await em.persistAndFlush(wa);
        }
    });
}

// monitoring
export async function fetchMonitoringState(rootEm: EntityManager, chainType: string): Promise<MonitoringStateEntity | null> {
    return await rootEm.findOne(MonitoringStateEntity, { chainType }, { refresh: true });
}

export async function updateMonitoringState(
    rootEm: EntityManager,
    chainType: string,
    modify: (stateEnt: MonitoringStateEntity) => void
): Promise<void> {
    await transactional(rootEm, async (em) => {
        const stateEnt = await fetchMonitoringState(em, chainType);
        /* istanbul ignore if */
        if (!stateEnt) {
            return;
        }
        modify(stateEnt);
    });
}

export async function handleFeeToLow(rootEm: EntityManager, txEnt: TransactionEntity): Promise<void> {
    await updateTransactionEntity(rootEm, txEnt.id, (txEnt) => {
        txEnt.status = TransactionStatus.TX_CREATED;
        txEnt.inputs.removeAll();
        txEnt.outputs.removeAll();
        txEnt.raw = "";
        txEnt.transactionHash = "";
        txEnt.fee = undefined;
        txEnt.size = undefined;
    });
}

export const DB_MAX_RETRIES = 3;

export async function retryDatabaseTransaction<T>(explanation: string, action: () => Promise<T>, maxRetries: number = DB_MAX_RETRIES) {
    for (let i = 1; i <= maxRetries; i++) {
        try {
            return await action();
        } catch (error) {
            const nextAction = i <= maxRetries ? `retrying (${i})` : `failed`;
            logger.error(`Error ${explanation} - ${nextAction}:`, error);
        }
    }
    throw new Error(`Too many failed attempts ${explanation}`);
}

/**
 * Like EntityManager.transactional(...), but throws full stack trace on error.
 */
export async function transactional<T>(rootEm: EntityManager, cb: (em: EntityManager) => Promise<T>, options?: TransactionOptions): Promise<T> {
    try {
        return await rootEm.transactional(cb, options);
    } catch (error) {
        throw updateErrorWithFullStackTrace(error);
    }
}
