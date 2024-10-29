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
import { MonitoringStateEntity } from "../entity/monitoringState";
import Output = Transaction.Output;
import { TransactionInputEntity } from "../entity/transactionInput";
import { getCurrentTimestampInSeconds } from "../utils/utils";
import {
    MempoolUTXO,
    UTXORawTransaction,
    UTXORawTransactionInput,
    UTXORawTransactionOutput,
} from "../interfaces/IBlockchainAPI";
import { errorMessage } from "../utils/axios-utils";

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
): Promise<TransactionEntity> {
    logger.info(
        `Creating transaction ${source}, ${destination}, ${amountInDrops?.toString()};${
            replacementFor ? ` replacing ${replacementFor.id} (${replacementFor.transactionHash}).` : ""
        }`
    );
    return await rootEm.transactional(async (em) => {
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
            feeSource: feeSource,
        } as RequiredEntityData<TransactionEntity>);
        await em.flush();
        logger.info(`Created transaction ${ent.id}.`);
        return ent;
    });
}

export async function updateTransactionEntity(rootEm: EntityManager, id: number, modify: (transactionEnt: TransactionEntity) => void): Promise<void> {
    await rootEm.transactional(async (em) => {
        const transactionEnt: TransactionEntity = await fetchTransactionEntityById(rootEm, id);
        modify(transactionEnt);
        await em.persistAndFlush(transactionEnt);
    });
}

export async function fetchTransactionEntityById(rootEm: EntityManager, id: number): Promise<TransactionEntity> {
    return await rootEm.findOneOrFail(TransactionEntity, { id } as FilterQuery<TransactionEntity>, {
        refresh: true,
        populate: ["replaced_by", "rbfReplacementFor", "utxos", "inputs", "outputs", "ancestor", "ancestor.replaced_by"],
    });
}

export async function fetchTransactionEntities(rootEm: EntityManager, chainType: ChainType, statuses: TransactionStatus[]): Promise<TransactionEntity[]> {
    return await rootEm.find(
        TransactionEntity,
        {
            status: { $in: statuses },
            chainType,
        } as FilterQuery<TransactionEntity>,
        {
            refresh: true,
            populate: ["replaced_by", "rbfReplacementFor", "utxos", "inputs", "outputs", "ancestor", "ancestor.replaced_by"],
            orderBy: { id: "ASC" },
        }
    );
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

export function transformUTXOEntToTxInputEntity(utxo: UTXOEntity, transaction: TransactionEntity): TransactionInputEntity {
    /* istanbul ignore next */
    return createTransactionInputEntity(transaction, utxo.mintTransactionHash, utxo.value, utxo.position, utxo.script ?? "");
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

// utxo operations
export async function createUTXOEntity(
    rootEm: EntityManager,
    source: string,
    txHash: string,
    position: number,
    value: BN,
    script: string,
    spentTxHash: string | null = /* istanbul ignore next */ null,
    confirmed: boolean
): Promise<void> {
    rootEm.create(UTXOEntity, {
        source: source,
        mintTransactionHash: txHash,
        spentHeight: SpentHeightEnum.UNSPENT,
        position: position,
        value: value,
        script: script,
        spentTransactionHash: spentTxHash,
        confirmed: confirmed,
    } as RequiredEntityData<UTXOEntity>);
    await rootEm.flush();
}

export async function fetchUTXOEntity(rootEm: EntityManager, mintTxHash: string, position: number): Promise<UTXOEntity> {
    return await rootEm.findOneOrFail(
        UTXOEntity,
        {
            mintTransactionHash: mintTxHash,
            position: position,
        } as FilterQuery<UTXOEntity>,
        { refresh: true }
    );
}

export async function updateUTXOEntity(rootEm: EntityManager, txHash: string, position: number, modify: (utxoEnt: UTXOEntity) => void): Promise<void> {
    await rootEm.transactional(async (em) => {
        const utxoEnt: UTXOEntity = await fetchUTXOEntity(rootEm, txHash, position);
        modify(utxoEnt);
        await em.persistAndFlush(utxoEnt);
    });
}

export async function fetchUnspentUTXOs(rootEm: EntityManager, source: string, rbfUTXOs?: UTXOEntity[]): Promise<UTXOEntity[]> {
    const res = await rootEm.find(
        UTXOEntity,
        {
            source: source,
            spentHeight: SpentHeightEnum.UNSPENT,
        } as FilterQuery<UTXOEntity>,
        { refresh: true, orderBy: { confirmed: "desc", value: "desc" } }
    );

    const alreadyUsed = rbfUTXOs ?? [];
    const utxos = alreadyUsed.length > 0 ? res.filter((t) => t.confirmed) : res;
    return [...alreadyUsed, ...utxos]; // order is important for needed utxos later
}

export async function fetchUTXOsByTxId(rootEm: EntityManager, txId: number): Promise<UTXOEntity[]> {
    return await rootEm.transactional(async (em) => {
        const txEnt = await em.findOne(TransactionEntity, { id: txId });
        if (!txEnt || !txEnt.raw) {
            logger.error(`Transaction entity or raw data not found for transaction ${txId}`);
            return [];
        }
        let inputs: UTXORawTransactionInput[] = [];
        try {
            const tr = JSON.parse(txEnt.raw) as UTXORawTransaction;
            inputs = tr.inputs;
        } catch (error) {
            logger.error(`Failed to parse transaction raw data for transaction ${txId}: ${errorMessage(error)}`);
            return [];
        }
        const utxos = await rootEm.find(UTXOEntity, {
            $or: inputs.map((input) => ({
                mint_transaction_hash: input.prevTxId,
                position: input.outputIndex,
            })),
        });
        return utxos;
    });
}

export async function storeUTXOs(rootEm: EntityManager, source: string, mempoolUTXOs: MempoolUTXO[]): Promise<void> {
    for (const utxo of mempoolUTXOs) {
        try {
            await updateUTXOEntity(rootEm, utxo.mintTxid, utxo.mintIndex, (utxoEnt) => {
                utxoEnt.confirmed = utxo.confirmed;
            });
        } catch (e) { // eslint-disable-line @typescript-eslint/no-unused-vars
            await createUTXOEntity(rootEm, source, utxo.mintTxid, utxo.mintIndex, toBN(utxo.value), utxo.script, null, utxo.confirmed);
        }
    }
}

// it fetches unspent and sent utxos from db that do not match utxos from mempool and marks them as spent
export async function correctUTXOInconsistenciesAndFillFromMempool(rootEm: EntityManager, address: string, mempoolUTXOs: MempoolUTXO[]): Promise<void> {
    await rootEm.transactional(async (em) => {
        // find UTXOs in the db that are NOT in the mempool and mark them as spent
        const spentCondition = mempoolUTXOs.map((utxo) => ({
            $not: {
                mintTransactionHash: { $like: utxo.mintTxid },
                position: utxo.mintIndex,
            },
        }));
        const spentUtxos = (await em.find(UTXOEntity, {
            source: address,
            spentHeight: { $in: [SpentHeightEnum.UNSPENT, SpentHeightEnum.SENT] },
            $and: spentCondition,
        })) as UTXOEntity[];

        spentUtxos.forEach((utxoEnt) => {
            utxoEnt.spentHeight = SpentHeightEnum.SPENT;
        });
        if (spentUtxos.length > 0) {
            logger.info(`Marked ${spentUtxos.length} UTXOs as spent`);
        }
        // find UTXOs that ARE in the mempool and mark them as unspent
        const unspentCondition = mempoolUTXOs.map((utxo) => ({
            mintTransactionHash: { $like: utxo.mintTxid },
            position: utxo.mintIndex,
        }));
        const unspentUtxos = (await em.find(UTXOEntity, {
            source: address,
            spentHeight: { $eq: SpentHeightEnum.SPENT },
            $or: unspentCondition,
        })) as UTXOEntity[];
        unspentUtxos.forEach((utxo) => {
            utxo.spentHeight = SpentHeightEnum.UNSPENT;
        });
        /* istanbul ignore next */
        if (unspentUtxos.length > 0) {
            logger.info(`Marked ${unspentUtxos.length} UTXOs as unspent`);
        }
        await em.persistAndFlush([...spentUtxos, ...unspentUtxos]);
        // find new UTXOs in the mempool that are not yet in the db
        await storeUTXOs(rootEm, address, mempoolUTXOs);
    });
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

export async function failTransaction(rootEm: EntityManager, txId: number, reason: string, error?: Error): Promise<void> {
    await updateTransactionEntity(rootEm, txId, (txEnt) => {
        txEnt.status = TransactionStatus.TX_FAILED;
        txEnt.reachedFinalStatusInTimestamp = toBN(getCurrentTimestampInSeconds());
        txEnt.serverSubmitResponse = JSON.stringify(reason);
    });
    /* istanbul ignore next */
    if (error) {
        logger.error(`Transaction ${txId} failed: ${reason}`, error);
    } else {
        logger.error(`Transaction ${txId} failed: ${reason}`);
    }
}

export async function processTransactions(
    rootEm: EntityManager,
    chainType: ChainType,
    statuses: TransactionStatus[],
    processFunction: (txEnt: TransactionEntity) => Promise<void>
): Promise<void> {
    const transactionEntities = await fetchTransactionEntities(rootEm, chainType, statuses);
    for (const txEnt of transactionEntities) {
        try {
            await processFunction(txEnt);
        } catch (e) /* istanbul ignore next */ {
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
    logger.info(`Settings ${address} to be deleted.`);
    await rootEm.transactional(async (em) => {
        const wa = await rootEm.findOne(WalletAddressEntity, { address } as FilterQuery<WalletAddressEntity>);
        /* istanbul ignore else */
        if (wa) {
            wa.isDeleting = true;
            await em.persistAndFlush(wa);
        }
    });
}

// monitoring
export async function fetchMonitoringState(rootEm: EntityManager, chainType: string): Promise<MonitoringStateEntity | null> {
    return await rootEm.findOne(MonitoringStateEntity, { chainType } as FilterQuery<MonitoringStateEntity>, { refresh: true });
}

export async function updateMonitoringState(
    rootEm: EntityManager,
    chainType: string,
    modify: (stateEnt: MonitoringStateEntity) => void
): Promise<void> {
    await rootEm.transactional(async (em) => {
        const stateEnt = await fetchMonitoringState(rootEm, chainType);
        /* istanbul ignore if */
        if (!stateEnt) {
            return;
        }
        modify(stateEnt);
        await em.persistAndFlush(stateEnt);
    });
}

export async function handleFeeToLow(rootEm: EntityManager, txEnt: TransactionEntity): Promise<void> {
    let newFee: BN | undefined = undefined;
    if (txEnt.replaced_by) {
        newFee = txEnt.fee; //if tx was RBF, field fee holds needed fee to cover
    }

    await updateTransactionEntity(rootEm, txEnt.id, (txEnt) => {
        txEnt.status = TransactionStatus.TX_CREATED;
        txEnt.utxos.removeAll();
        txEnt.inputs.removeAll();
        txEnt.outputs.removeAll();
        txEnt.raw = "";
        txEnt.transactionHash = "";
        txEnt.fee = newFee;
    });
}
