import {TransactionInfo} from "../../src/interfaces/WalletTransactionInterface";
import {TransactionEntity, TransactionStatus} from "../../src/entity/transaction";
import {sleepMs} from "../../src/utils/utils";
import {toBN} from "../../src/utils/bnutils";
import {ChainType} from "../../src/utils/constants";
import {RequiredEntityData} from "@mikro-orm/core";
import {WALLET} from "../../src";
import BN from "bn.js";
import {ORM} from "../../src/orm/mikro-orm.config";
import {WalletEntity} from "../../src/entity/wallet";
import {fetchTransactionEntityById} from "../../src/db/dbutils";

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

function checkTimeout(tx: TransactionEntity | TransactionInfo, startTime: number, timeLimit: number) {
    if (Date.now() - startTime > timeLimit) {
        throw new Error(`Time limit exceeded for ${ tx instanceof TransactionEntity ? tx.id : tx.dbId} with ${tx.transactionHash}`);
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

async function createAndSignXRPTransactionWithStatus(wClient: WALLET.XRP, source: string, target: string, amount: BN, note: string, fee: BN, status: TransactionStatus) {
    const transaction = await wClient.preparePaymentTransaction(
        source,
        target,
        amount,
        fee,
        note,
    );
    const txEnt = wClient.orm.em.create(
        TransactionEntity,
        {
            chainType: ChainType.testXRP,
            source: source,
            destination: target,
            status: status,
            reference: note,
            amount: amount,
            fee: fee,
            raw: Buffer.from(JSON.stringify(transaction)),
            executeUntilBlock: transaction.LastLedgerSequence
        } as RequiredEntityData<TransactionEntity>,
    );
    const privateKey = await wClient.walletKeys.getKey(txEnt.source);
    txEnt.transactionHash = (await wClient.signTransaction(JSON.parse(txEnt.raw!.toString()), privateKey!)).txHash;

    await wClient.orm.em.flush();

    return txEnt;
}

async function clearTransactions(orm: ORM) {
    await orm.em.nativeDelete(TransactionEntity, {});
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
    checkTimeout,
    loop,
    createAndSignXRPTransactionWithStatus,
    clearTransactions,
    setWalletStatusInDB,

    TEST_WALLET_XRP,
    END_STATUSES
}