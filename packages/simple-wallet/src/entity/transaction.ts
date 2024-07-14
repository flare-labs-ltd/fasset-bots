import { Entity, OneToOne, PrimaryKey, Property } from "@mikro-orm/core";
import { BNType } from "../orm/orm-types";
import BN from "bn.js";
import { ChainType } from "../utils/constants";

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

    @Property({ nullable: true  })
    executeUntilBlock?: number;

    @Property({ nullable: true  })
    executeUntilTimestamp?: number;

    @Property({ nullable: true  })
    confirmations?: number;

    @Property({ nullable: true  })
    sequence?: number;

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
    TX_CREATED = "created",
    TX_REPLACED = "replaced",
    TX_SUBMISSION_FAILED = "submission_failed", // in xrp this means failed due ti insufficient fee -> replace tx
    TX_SUBMITTED = "submitted",
    TX_PENDING = "pending", // in xrp this means that submit fn received error -> tx might be submitted or not
    TX_SUCCESS = "success",
    TX_FAILED = "failed"
}
