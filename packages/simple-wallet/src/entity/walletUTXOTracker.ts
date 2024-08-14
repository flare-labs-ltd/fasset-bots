import { Entity, ManyToOne, PrimaryKey, Property } from "@mikro-orm/core";
import { ChainType } from "../utils/constants";
import { WalletAddressEntity } from "./wallet";

@Entity()
export class WalletUTXOTracker {
    @PrimaryKey()
    id!: number;

    @Property()
    chainType!: ChainType;

    @Property()
    numTxsInMempool!: number;

    @ManyToOne(() => WalletAddressEntity)
    walletAddress!: WalletAddressEntity;

    @Property({onCreate: () => new Date()})
    createdAt: Date = new Date();

    @Property({onUpdate: () => new Date()})
    updatedAt: Date = new Date();
}
