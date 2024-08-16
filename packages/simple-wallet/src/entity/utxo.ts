import { Entity, PrimaryKey, Property } from "@mikro-orm/core";
import BN from "bn.js";
import { BNType } from "../utils/orm-types";

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

    @Property({ type: BNType })
    value!: BN;

    @Property()
    script!: string;

    @Property({ onCreate: () => new Date() })
    createdAt: Date = new Date();

    @Property({ onUpdate: () => new Date() })
    updatedAt: Date = new Date();
}

export enum SpentHeightEnum {
    SPENT = 0,
    PENDING = -1,
    UNSPENT = -2,
    SENT = -3
}