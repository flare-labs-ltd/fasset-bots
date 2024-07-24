import {TransactionInfo} from "../../src/interfaces/WalletTransactionInterface";
import {TransactionEntity, TransactionStatus} from "../../src/entity/transaction";
import {sleepMs} from "../../src/utils/utils";
import {ChainType} from "../../src/utils/constants";
import {RequiredEntityData} from "@mikro-orm/core";
import {WALLET} from "../../src";
import BN from "bn.js";
import {ORM} from "../../src/orm/mikro-orm.config";
import {WalletEntity} from "../../src/entity/wallet";
import {fetchTransactionEntityById, getTransactionInfoById} from "../../src/db/dbutils";
import {UTXOEntity} from "../../src/entity/utxo";

function checkStatus(tx: TransactionInfo | TransactionEntity, allowedEndStatuses: TransactionStatus[]): boolean;
function checkStatus(tx: TransactionInfo | TransactionEntity, allowedEndStatuses: TransactionStatus[], notAllowedEndStatuses: TransactionStatus[]): boolean;
function checkStatus(tx: TransactionInfo | TransactionEntity, allowedEndStatuses: TransactionStatus[], notAllowedEndStatuses?: TransactionStatus[]): boolean {
    if (notAllowedEndStatuses) {
        if (allowedEndStatuses.includes(tx.status)) {
            return true;
        } else if (notAllowedEndStatuses.includes(tx.status)) {
            throw new Error(`Exited with wrong status ${tx.status}`);
        } else {
            return false;
        }
    } else {
        const calculatedNotAllowedEndStatuses = END_STATUSES.filter(t => !allowedEndStatuses.includes(t));
        return checkStatus(tx, allowedEndStatuses, calculatedNotAllowedEndStatuses);
    }
}

async function loop(sleepIntervalMs: number, timeLimit: number, tx: TransactionEntity | TransactionInfo | null, conditionFn: any) {
    const startTime = Date.now();
    while (true) {
        const shouldStop = await conditionFn();
        if (shouldStop) break;
        if (Date.now() - startTime > timeLimit) {
            throw tx ?
                new Error(`Time limit exceeded for ${ tx instanceof TransactionEntity ? tx.id : tx.dbId} with ${tx.transactionHash}`) :
                new Error(`Time limit exceeded`);
        }

        await sleepMs(sleepIntervalMs);
    }
}

/**
 *
 * @param sleepInterval in seconds
 * @param timeLimit in seconds
 * @param orm
 * @param status
 * @param txId
 */
async function waitForTxToFinishWithStatus(sleepInterval: number, timeLimit: number, orm: ORM, status: TransactionStatus, txId: number): Promise<[TransactionEntity, TransactionInfo]> {
    let tx = await fetchTransactionEntityById(orm, txId);
    await loop(sleepInterval * 1000, timeLimit * 1000, tx,async () => {
        orm.em.clear();
        tx = await fetchTransactionEntityById(orm, txId);
        return checkStatus(tx, [status]);
    });

    return [await fetchTransactionEntityById(orm, txId), await getTransactionInfoById(orm, txId)];
}

async function waitForTxToBeReplacedWithStatus(sleepInterval: number, timeLimit: number, wClient: WALLET.XRP | WALLET.BTC | WALLET.DOGE, status: TransactionStatus, txId: number): Promise<[TransactionEntity, TransactionInfo]> {
    let txInfo = await wClient.getTransactionInfo(txId);
    let replacedTx: TransactionEntity | TransactionInfo | null = null;

    await loop(sleepInterval * 1000, timeLimit * 1000, txInfo, async () => {
        wClient.orm.em.clear();
        txInfo = await wClient.getTransactionInfo(txId);
        if (txInfo.replacedByDdId)
            replacedTx = await fetchTransactionEntityById(wClient.orm, txInfo.replacedByDdId);
        if (replacedTx)
            return checkStatus(replacedTx, [status]);
    });

    return [await fetchTransactionEntityById(wClient.orm, txId), await wClient.getTransactionInfo(txId)];
}

function createTransactionEntity(
    orm: ORM,
    chainType: ChainType,
    source: string,
    destination: string,
    amountInDrops: BN | null,
    feeInDrops?: BN,
    note?: string,
    maxFee?: BN,
    executeUntilBlock?: number,
    executeUntilTimestamp?: number
) {
    return orm.em.create(
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
}

async function createAndSignXRPTransactionWithStatus(wClient: WALLET.XRP, source: string, target: string, amount: BN, note: string, fee: BN, status: TransactionStatus) {
    const transaction = await wClient.preparePaymentTransaction(
        source,
        target,
        amount,
        fee,
        note,
    );

    const txEnt = createTransactionEntity(wClient.orm, ChainType.testXRP, source, target, amount, fee, note, undefined, transaction.LastLedgerSequence);
    const privateKey = await wClient.walletKeys.getKey(txEnt.source);
    txEnt.raw = Buffer.from(JSON.stringify(transaction));
    txEnt.transactionHash = (await wClient.signTransaction(JSON.parse(txEnt.raw!.toString()), privateKey!)).txHash;
    txEnt.status = status;

    await wClient.orm.em.flush();
    return txEnt;
}

async function clearTransactions(orm: ORM) {
    await orm.em.nativeDelete(TransactionEntity, {});
    await orm.em.flush();
}

async function clearUTXOs(orm: ORM) {
    await orm.em.nativeDelete(UTXOEntity, {});
    await orm.em.flush();
}

async function updateWalletInDB(orm: ORM, address: string, modify: (walletEnt: WalletEntity) => Promise<void>) {
    await orm.em.transactional(async (em) => {
        const ent = await orm.em.findOneOrFail(WalletEntity, {'address': address});
        await modify(ent);
        await em.persistAndFlush(ent);
    });
}

async function setWalletStatusInDB(orm: ORM, address: string, isDeleting: boolean) {
    await updateWalletInDB(orm, address, async walletEnt => {
        walletEnt.isDeleting = isDeleting;
    });
}

const END_STATUSES = [TransactionStatus.TX_REPLACED, TransactionStatus.TX_FAILED, TransactionStatus.TX_SUBMISSION_FAILED, TransactionStatus.TX_SUCCESS];
const TEST_WALLET_XRP = {
    address: "rpZ1bX5RqATDiB7iskGLmspKLrPbg5X3y8"
}

export {
    checkStatus,
    loop,
    waitForTxToFinishWithStatus,
    waitForTxToBeReplacedWithStatus,

    createTransactionEntity,
    createAndSignXRPTransactionWithStatus,

    clearTransactions,
    clearUTXOs,

    setWalletStatusInDB,

    TEST_WALLET_XRP,
    END_STATUSES
}