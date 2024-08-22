import { Collection, Entity, Filter, OneToMany, OneToOne, PrimaryKey, Property } from "@mikro-orm/core";
import BN from "bn.js";
import {ChainType} from "../utils/constants";
import {BNType} from "../utils/orm-types";
import {TransactionOutputEntity} from "./transactionOutput";
import { UTXOEntity } from "./utxo";

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

    @Property({nullable: true})
    submittedInTimestamp?: Date; // server time - needed to track when tx appears in mempool

    @Property({nullable: true})
    acceptedToMempoolInTimestamp?: Date;

    @Property({nullable: true})
    reachedFinalStatusInTimestamp?: Date; // TX_REPLACED, TX_FAILED, TX_SUCCESS

    @Property({nullable: true})
    reachedStatusPreparedInTimestamp?: Date;

    @Property({nullable: true})
    reachedStatusPendingInTimestamp?: Date;

    @Property({ nullable: true  })
    executeUntilBlock?: number;

    @Property({ nullable: true  })
    executeUntilTimestamp?: Date;

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

    @OneToMany(() => TransactionOutputEntity, output => output.transaction)
    inputsAndOutputs = new Collection<TransactionOutputEntity>(this);

    @OneToMany(() => UTXOEntity, utxo => utxo.transaction)
    utxos = new Collection<UTXOEntity>(this);
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
