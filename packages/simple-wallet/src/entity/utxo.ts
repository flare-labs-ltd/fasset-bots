import { Entity, PrimaryKey, Property } from "@mikro-orm/core";

@Entity({ tableName: "utxo" })
export class UTXOEntity {
    @PrimaryKey({ autoincrement: true })
    id!: number;

    @Property()
    source!: string;

    @Property()
    mintTransactionHash!: string;

    @Property({ nullable: true })
    spentTransactionHash?: string;

    @Property()
    position!: number;

    @Property()
    spentHeight!: SpentHeightEnum;

    @Property({ columnType: 'blob' })
    raw!: Buffer;

    @Property({ onCreate: () => new Date() })
    createdAt: Date = new Date();

    @Property({ onUpdate: () => new Date() })
    updatedAt: Date = new Date();
}

export enum SpentHeightEnum {
    SPENT = 0,
    PENDING = -2,
    UNSPENT = -1
}