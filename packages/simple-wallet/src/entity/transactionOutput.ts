import {Entity, ManyToOne, PrimaryKey, Property} from "@mikro-orm/core";
import {BNType} from "../utils/orm-types";
import BN from "bn.js";
import { TransactionEntity } from "./transaction";

@Entity({tableName: "transaction_output"})
export class TransactionOutputEntity {
    @PrimaryKey({ autoincrement: true })
    id!: number;

    @Property()
    transactionHash!: string;

    @Property({nullable: true})
    vout?: number;

    @Property({type: BNType})
    amount!: BN;

    @Property()
    script!: string;

    @Property({ onCreate: () => new Date(), defaultRaw: 'CURRENT_TIMESTAMP' })
    createdAt: Date = new Date();

    @Property({ onUpdate: () => new Date(), defaultRaw: 'CURRENT_TIMESTAMP' })
    updatedAt: Date = new Date();

    @ManyToOne(() => TransactionEntity)
    transaction!: TransactionEntity;
}