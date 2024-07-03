import { Entity, OneToOne, PrimaryKey, Property } from "@mikro-orm/core";
import { ADDRESS_LENGTH, BYTES32_LENGTH, ChainType } from "../utils/constants";

@Entity({ tableName: "transaction" })
export class TransactionEntity {
    @PrimaryKey({ autoincrement: true })
    id!: number;

    @Property()
    chain!: keyof typeof ChainType;

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

    @OneToOne(() => TransactionEntity, { nullable: true })
    replaced_by?: TransactionEntity;
}

export enum TransactionStatus {
    TX_REPLACED = -2,
    TX_SENT = -1,
    TX_SUCCESS = 0,
    TX_FAILED = 1,
    TX_BLOCKED = 2,
}
