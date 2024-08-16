import { Entity, OneToOne, PrimaryKey, Property } from "@mikro-orm/core";
import BN from "bn.js";
import { ChainType } from "../utils/constants";
import { BNType } from "../utils/orm-types";

@Entity({ tableName: "transaction" })
export class TransactionEntity {
    @PrimaryKey({ autoincrement: true })
    id!: number;

    @Property()
    chainType!: ChainType;

    @Property()
    source!: string;

    @Property()
    destination!: string;

    @Property({ nullable: true })
    transactionHash?: string;

    @Property()
    status!: TransactionStatus;

    @Property({ type: BNType, nullable: true })
    fee?: BN;

    @Property({ type: BNType, nullable: true })
    maxFee?: BN;

    @Property()
    submittedInBlock: number = 0; // 0 when tx is created

    @Property()
    submittedInTimestamp = 0; // server time - needed to track when tx appears in mempool

    @Property({nullable: true})
    acceptedToMempoolInTimestamp?: number;

    @Property()
    reachedFinalStatusInTimestamp: number = 0; // TX_REPLACED, TX_FAILED, TX_SUCCESS

    @Property({nullable: true})
    reachedStatusPreparedInTimestamp: number = 0;

    @Property({nullable: true})
    reachedStatusPendingInTimestamp: number = 0;

    @Property({ nullable: true  })
    executeUntilBlock?: number;

    @Property({ nullable: true  })
    executeUntilTimestamp?: number;

    @Property({ nullable: true  })
    confirmations?: number;

    @Property({ nullable: true  })
    reference?: string;

    @Property({ type: BNType, nullable: true  })
    amount?: BN;

    @Property({ columnType: 'blob', nullable: true })
    raw?: Buffer;

    @Property({ columnType: 'blob', nullable: true })
    serverSubmitResponse?: Buffer;

    @OneToOne(() => TransactionEntity, { nullable: true })
    replaced_by?: TransactionEntity;

    @Property({ onCreate: () => new Date() })
    createdAt: Date = new Date();

    @Property({ onUpdate: () => new Date() })
    updatedAt: Date = new Date();
}

export enum TransactionStatus {
    TX_CREATED = "created", // received tx is initially stored in db
    TX_PREPARED = "prepared",
    TX_REPLACED = "replaced", // tx was replaced with new transaction
    TX_SUBMISSION_FAILED = "submission_failed", //xrp: failed due ti insufficient fee -> replace tx
    TX_SUBMITTED = "submitted", // utxo: tx is in mempool
    TX_PENDING = "pending", //xrp: submit fn received error -> tx might be submitted or not; utxo: tx was send but was not yet seen in mempool
    TX_SUCCESS = "success", // confirmed transaction: xrp -> tx is in validated ledger; utxo -> tx was confirmed by x blocks
    TX_FAILED = "failed"
}
