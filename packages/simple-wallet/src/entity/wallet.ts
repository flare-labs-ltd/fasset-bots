import { Entity, PrimaryKey, Property } from "@mikro-orm/core";

@Entity()
export class WalletAddressEntity {
    @PrimaryKey()
    address!: string;

    @Property()
    encryptedPrivateKey!: string;

    @Property()
    isDeleting: boolean = false;
}
