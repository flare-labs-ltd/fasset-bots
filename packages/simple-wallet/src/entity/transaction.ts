import { Collection, Entity, Index, ManyToOne, OneToMany, OneToOne, PrimaryKey, Property } from "@mikro-orm/core";
import BN from "bn.js";
import {ChainType} from "../utils/constants";
import { BNType, TextType } from "../utils/orm-types";
import {TransactionInputEntity} from "./transactionInput";

@Entity({ tableName: "transaction" })
@Index({properties: ["transactionHash"]})
@Index({properties: ["chainType", "status"]})
export class TransactionEntity {
    @PrimaryKey({ autoincrement: true })
    id!: number;

    @Property({ type: "varchar", length: 64 })
    chainType!: ChainType;

    @Property({ type: "varchar", length: 128 })
    source!: string;

    @Property({ type: "varchar", length: 128 })
    destination!: string;

    @Property({ type: "varchar", length: 128, nullable: true })
    transactionHash?: string;

    @Property({ type: "varchar", length: 64 })
    status!: TransactionStatus;

    @Property({ type: BNType, nullable: true })
    fee?: BN;

    @Property({ nullable: true })
    size?: number;

    @Property({ type: BNType, nullable: true })
    maxFee?: BN;

    @Property({ columnType: "decimal(16, 0)" })
    submittedInBlock = 0; // 0 when tx is created

    @Property({ type: BNType, nullable: true })
    acceptedToMempoolInTimestamp?: BN;

    @Property({ type: BNType, nullable: true })
    reachedFinalStatusInTimestamp?: BN; // TX_REPLACED, TX_FAILED, TX_SUCCESS

    @Property({ type: BNType, nullable: true })
    reachedStatusPreparedInTimestamp?: BN;

    @Property({ type: BNType, nullable: true })
    reachedStatusPendingInTimestamp?: BN; // server time - needed to track when tx appears in mempool

    @Property({ nullable: true  })
    executeUntilBlock?: number;

    @Property({ type: BNType, nullable: true  })
    executeUntilTimestamp?: BN;

    @Property({ nullable: true  })
    reference?: string;

    @Property({ type: BNType, nullable: true  })
    amount?: BN;

    @Property({ type: TextType, nullable: true })
    raw?: string;

    @Property({ type: TextType, nullable: true })
    serverSubmitResponse?: string;

    @Property({ type: TextType, nullable: true })
    lastProcessingError?: string;

    @Property()
    isFreeUnderlyingTransaction: boolean = false;

    @OneToOne(() => TransactionEntity, { nullable: true })
    replaced_by?: TransactionEntity | null;

    @OneToOne(() => TransactionEntity, { nullable: true })
    rbfReplacementFor?: TransactionEntity | null;

    @Property({ onCreate: () => new Date(), defaultRaw: "CURRENT_TIMESTAMP" })
    createdAt: Date = new Date();

    @Property({ onUpdate: () => new Date(), defaultRaw: "CURRENT_TIMESTAMP" })
    updatedAt: Date = new Date();

    @OneToMany(() => TransactionInputEntity, input => input.transaction, {orphanRemoval: true})
    inputs = new Collection<TransactionInputEntity>(this);

    @ManyToOne(() => TransactionEntity, { nullable: true })
    ancestor?: TransactionEntity | null;

    @Property({ type: "varchar", length: 128, nullable: true })
    feeSource?: string;

    @Property({ type: BNType, nullable: true })
    maxPaymentForFeeSource?: BN;

    @Property()
    numberOfOutputs: number = 0;

    @Property({ type: BNType, nullable: true })
    minFeePerKB?: BN;
}

export enum TransactionStatus {
    TX_CREATED = "created", // received tx is initially stored in db
    TX_PREPARED = "prepared",
    TX_REPLACED = "replaced", // tx was replaced with new transaction
    TX_REPLACED_PENDING = "replaced_pending", // (in utxo) pending replacement (when we don't know if original or replacement will be accepted)
    TX_SUBMISSION_FAILED = "submission_failed", //xrp: failed due to insufficient fee -> replace tx
    TX_SUBMITTED = "submitted", // utxo: tx is in mempool
    TX_PENDING = "pending", //xrp: submit fn received error -> tx might be submitted or not; utxo: tx was send but was not yet seen in mempool
    TX_SUCCESS = "success", // confirmed transaction: xrp -> tx is in validated ledger; utxo -> tx was confirmed by x blocks
    TX_FAILED = "failed"
}
