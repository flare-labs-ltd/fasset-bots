import { Entity, PrimaryKey, Property } from "@mikro-orm/core";

@Entity()
export class WalletAddressEntity {
    @PrimaryKey()
    address!: string;

    @Property()
    encryptedPrivateKey!: string;

    @Property()
    isDeleting: boolean = false;

    @Property({ onCreate: () => new Date() })
    createdAt: Date = new Date();

    @Property({ onUpdate: () => new Date() })
    updatedAt: Date = new Date();
}
