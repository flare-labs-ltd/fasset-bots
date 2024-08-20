import { Collection, Entity, OneToMany, OneToOne, PrimaryKey, Property } from "@mikro-orm/core";
import { WalletUTXOTracker } from "./walletUTXOTracker";

@Entity()
export class WalletAddressEntity {
    @PrimaryKey()
    address!: string;

    @Property()
    encryptedPrivateKey!: string;

    @Property()
    isDeleting: boolean = false;

    @OneToMany(() => WalletUTXOTracker, utxoTracker => utxoTracker.walletAddress)
    utxoTrackers = new Collection<WalletUTXOTracker>(this);
}
