import {
    logger,
    SpentHeightEnum,
    TransactionEntity,
    TransactionStatus,
    UTXOEntity,
    WalletAddressEntity,
    XRP,
} from "../../src";
import { ChainType } from "../../src/utils/constants";
import BN from "bn.js";
import { TransactionInputEntity } from "../../src/entity/transactionInput";
import { toBN } from "web3-utils";
import { EntityManager, RequiredEntityData } from "@mikro-orm/core";
import { transactional, updateMonitoringState } from "../../src/db/dbutils";
import { TransactionOutputEntity } from "../../src/entity/transactionOutput";

export function createTransactionEntity(source: string, destination: string, txHash: string, utxos?: UTXOEntity[], inputs?: TransactionEntity[], status?: TransactionStatus): TransactionEntity {
    const txEnt = new TransactionEntity();
    txEnt.chainType = ChainType.testBTC;
    txEnt.status = status ?? TransactionStatus.TX_SUCCESS;
    txEnt.source = source;
    txEnt.transactionHash = txHash;
    txEnt.destination = destination;
    txEnt.utxos.set(utxos ?? []);
    if (inputs) {
        txEnt.inputs.set(inputs.map(t => createTransactionInputEntity(t.transactionHash!, 0)));
    }
    return txEnt;
}

export function createTransactionEntityBase(id: number, source: string, destination: string, fee: BN, utxos: UTXOEntity[]) {
    const txEnt = new TransactionEntity();
    txEnt.id = id;
    txEnt.source = source;
    txEnt.destination = destination;
    txEnt.fee = fee;
    txEnt.utxos.set(utxos);
    return txEnt;
}

export function createUTXOEntity(id: number, source: string, mintTransactionHash: string, position: 0, spentHeight: SpentHeightEnum, value: BN, script: string, confirmed?: boolean) {
    const utxoEnt = new UTXOEntity();
    utxoEnt.id = id;
    utxoEnt.source = source;
    utxoEnt.mintTransactionHash = mintTransactionHash;
    utxoEnt.position = position;
    utxoEnt.spentHeight = spentHeight;
    utxoEnt.script = script;
    utxoEnt.value = value;
    utxoEnt.confirmed = confirmed ?? true;
    return utxoEnt;
}

export async function createAndPersistUTXOEntity(
    em: EntityManager,
    source: string,
    mintTransactionHash: string,
    position: number,
    spentHeight?: SpentHeightEnum,
    value?: BN,
    script?: string,
    confirmed?: boolean
) {
    const utxoEntity = em.create(UTXOEntity, {
        source: source,
        mintTransactionHash: mintTransactionHash,
        position: position,
        value: value ?? toBN(0),
        spentHeight: spentHeight ?? SpentHeightEnum.SPENT,
        script: script ?? "",
        confirmed: confirmed ?? true
    } as RequiredEntityData<UTXOEntity>);
    await em.persistAndFlush(utxoEntity);
    return utxoEntity;
}


export function createTransactionInputEntity(transactionHash: string, vout: number) {
    const inputEnt = new TransactionInputEntity();
    inputEnt.transactionHash = transactionHash;
    inputEnt.vout = vout;
    inputEnt.amount = toBN(0);
    inputEnt.script = "";
    return inputEnt;
}

export function createTransactionOutputEntity(transactionHash: string, vout: number) {
    const inputEnt = new TransactionOutputEntity();
    inputEnt.transactionHash = transactionHash;
    inputEnt.vout = vout;
    inputEnt.amount = toBN(0);
    inputEnt.script = "";
    return inputEnt;
}

export async function createAndPersistTransactionEntity(
    rootEm: EntityManager,
    chainType: ChainType,
    source: string,
    destination: string,
    amountInDrops: BN | null,
    feeInDrops?: BN,
    note?: string,
    maxFee?: BN,
    executeUntilBlock?: number,
    executeUntilTimestamp?: BN
): Promise<TransactionEntity> {
    return await transactional(rootEm, async (em) => {
        const ent = em.create(
            TransactionEntity,
            {
                chainType,
                source,
                destination,
                status: TransactionStatus.TX_CREATED,
                maxFee: maxFee ?? null,
                executeUntilBlock: executeUntilBlock ?? null,
                executeUntilTimestamp: executeUntilTimestamp ?? null,
                reference: note ?? null,
                amount: amountInDrops,
                fee: feeInDrops ?? null
            } as RequiredEntityData<TransactionEntity>,
        );
        await em.flush();
        logger.info(`Created transaction ${ent.id}.`);
        return ent;
    });
}

export async function createAndSignXRPTransactionWithStatus(wClient: XRP, source: string, target: string, amount: BN, note: string, fee: BN, status: TransactionStatus) {
    const transaction = await wClient.preparePaymentTransaction(
        source,
        target,
        amount,
        fee,
        note,
    );

    const txEnt = await createAndPersistTransactionEntity(wClient.rootEm, ChainType.testXRP, source, target, amount, fee, note, undefined, transaction.LastLedgerSequence);
    const privateKey = await wClient.walletKeys.getKey(txEnt.source);
    txEnt.raw = JSON.stringify(transaction);
    txEnt.transactionHash = wClient.signTransaction(JSON.parse(txEnt.raw), privateKey!).txHash;
    txEnt.status = status;

    await wClient.rootEm.flush();
    return txEnt;
}

export async function clearUTXOs(rootEm: EntityManager) {
    await rootEm.nativeDelete(UTXOEntity, {});
    await rootEm.flush();
}

export async function updateWalletInDB(rootEm: EntityManager, address: string, modify: (walletEnt: WalletAddressEntity) => Promise<void>) {
    await transactional(rootEm, async (em) => {
        const ent = await em.findOneOrFail(WalletAddressEntity, {'address': address});
        await modify(ent);
        await em.persistAndFlush(ent);
    });
}

export async function setWalletStatusInDB(rootEm: EntityManager, address: string, isDeleting: boolean) {
    await updateWalletInDB(rootEm, address, async walletEnt => {
        walletEnt.isDeleting = isDeleting;
    });
}

export async function setMonitoringStatus(rootEm: EntityManager, chainType: ChainType, monitoring: number) {
    await updateMonitoringState(rootEm, chainType, (monitoringEnt) => {
        monitoringEnt.lastPingInTimestamp = toBN(monitoring);
    });
}