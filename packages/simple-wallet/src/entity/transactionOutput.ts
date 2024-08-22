import { Entity, ManyToMany, ManyToOne, PrimaryKey, Property } from "@mikro-orm/core";
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

    @Property({type: "text"})
    script!: string;

    @ManyToOne(() => TransactionEntity)
    transaction!: TransactionEntity;

    @Property()
    isInput: boolean = false;

    @Property({onCreate: () => new Date()})
    createdAt: Date = new Date();

    @Property({onUpdate: () => new Date()})
    updatedAt: Date = new Date();

}