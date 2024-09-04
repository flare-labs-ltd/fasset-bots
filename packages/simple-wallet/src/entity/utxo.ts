import { Entity, Index, ManyToOne, PrimaryKey, Property } from "@mikro-orm/core";
import BN from "bn.js";
import { BNType } from "../utils/orm-types";
import { TransactionEntity } from "./transaction";

@Entity({ tableName: "utxo" })
export class UTXOEntity {
    @PrimaryKey({ autoincrement: true })
    id!: number;

    @Index({name: "source_index"})
    @Property()
    source!: string;

    @Index({name: "mint_transaction_hash_index"})
    @Property()
    mintTransactionHash!: string;

    @Property({ nullable: true })
    spentTransactionHash?: string;

    @Index({name: "mint_transaction_hash_position_index"})
    @Property()
    position!: number;

    @Index({name: "source_spent_height_index"})
    @Property()
    spentHeight!: SpentHeightEnum;

    @Property({ type: BNType })
    value!: BN;

    @Property({ nullable: true, type: "text"})
    script?: string;

    @Property({ onCreate: () => new Date(), defaultRaw: 'CURRENT_TIMESTAMP' })
    createdAt: Date = new Date();

    @Property({ onUpdate: () => new Date(), defaultRaw: 'CURRENT_TIMESTAMP' })
    updatedAt: Date = new Date();

    @ManyToOne(() => TransactionEntity, {nullable: true})
    transaction?: TransactionEntity;

    @Property()
    confirmed: boolean = false;
}

export enum SpentHeightEnum {
    SPENT = 0,
    PENDING = -1,
    UNSPENT = -2,
    SENT = -3
}