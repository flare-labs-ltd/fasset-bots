import { Entity, OneToOne, PrimaryKey, Property } from "@mikro-orm/core";
import { ADDRESS_LENGTH, BYTES32_LENGTH } from "../utils/constants";

@Entity({ tableName: "transaction" })
export class TransactionEntity {
    @PrimaryKey({ autoincrement: true })
    id!: number;

    @Property({ length: ADDRESS_LENGTH })//TODO
    source!: string;

    @Property({ length: ADDRESS_LENGTH })//TODO
    destination!: string;

    @Property({ length: BYTES32_LENGTH })//TODO
    transactionHash!: string;

    @Property()
    status!: TransactionStatus;

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
