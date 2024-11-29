import { Entity, PrimaryKey, Property, Unique } from "@mikro-orm/core";
import BN from "bn.js";
import { BNType } from "../utils/orm-types";

@Entity({ tableName: "history_item" })
@Unique({ properties: ["chainType", "blockHeight"] })
export class HistoryItem {
    @PrimaryKey({ autoincrement: true })
    id!: number;

    @Property({ length: 32 })
    chainType!: string;

    @Property({ type: "integer" })
    blockHeight!: number;

    @Property({ type: BNType, nullable: true })
    averageFeePerKB: BN | null = null;

    @Property({ type: BNType, nullable: true })
    timestamp: BN | null = null;

    @Property({ onCreate: () => new Date(), defaultRaw: 'CURRENT_TIMESTAMP' })
    createdAt?: Date = new Date();

    @Property({ onUpdate: () => new Date(), defaultRaw: 'CURRENT_TIMESTAMP' })
    updatedAt?: Date = new Date();
}
