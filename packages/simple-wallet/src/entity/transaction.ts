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

    @Property({ nullable: true  })
    executeUntilBlock!: number;

    @Property()
    confirmations!: number;

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
    TX_REPLACED = -2,
    TX_SENT = -1,
    TX_SUCCESS = 0,
    TX_FAILED = 1,
    TX_NOT_ACCEPTED = 2
}
