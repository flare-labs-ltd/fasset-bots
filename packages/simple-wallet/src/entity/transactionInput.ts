import { Entity, ManyToOne, PrimaryKey, Property } from "@mikro-orm/core";
import { BNType, TextType } from "../utils/orm-types";
import BN from "bn.js";
import { TransactionEntity } from "./transaction";

@Entity({ tableName: "transaction_input" })
export class TransactionInputEntity {
    @PrimaryKey({ autoincrement: true })
    id!: number;

    @Property()
    transactionHash!: string;

    @Property()
    vout!: number;

    @Property({type: BNType})
    amount!: BN;

    @Property({type: TextType})
    script!: string;

    @ManyToOne(() => TransactionEntity)
    transaction!: TransactionEntity;

    @Property({ onCreate: () => new Date(), defaultRaw: "CURRENT_TIMESTAMP" })
    createdAt: Date = new Date();

    @Property({ onUpdate: () => new Date(), defaultRaw: "CURRENT_TIMESTAMP" })
    updatedAt: Date = new Date();
}