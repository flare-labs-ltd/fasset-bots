import { Entity, OneToOne, PrimaryKey, Property } from "@mikro-orm/core";
import { BNType } from "../orm/orm-types";
import BN from "bn.js";

@Entity({ tableName: "transaction" })
export class TransactionEntity {
    @PrimaryKey({ autoincrement: true })
    id!: number;

    @Property()
    source!: string;

    @Property()
    destination!: string;

    @Property()
    transactionHash!: string;

    @Property()
    status!: TransactionStatus;

    @Property({ type: BNType, nullable: true })
    maxFee?: BN;

    @Property()
    submittedInBlock!: number;

    @Property({ nullable: true  })
    executeUntilBlock?: number;

    @Property({ nullable: true  })
    executeUntilTimestamp?: number;

    @Property({ nullable: true  })
    confirmations?: number;

    @Property({ nullable: true  })
    reference?: string;

    @Property({ columnType: 'blob' })
    raw!: Buffer;

    @OneToOne(() => TransactionEntity, { nullable: true })
    replaced_by?: TransactionEntity;

    @Property({ onCreate: () => new Date() })
    createdAt: Date = new Date();

    @Property({ onUpdate: () => new Date() })
    updatedAt: Date = new Date();
}

export enum TransactionStatus {
    TX_REPLACED = "replaced",
    TX_SUBMITTED = "submitted",
    TX_PENDING = "pending",
    TX_SUCCESS = "success",
    TX_FAILED = "failed",
    TX_NOT_ACCEPTED = "not_accepted"
}
