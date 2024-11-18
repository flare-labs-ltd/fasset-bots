import { Entity, PrimaryKey, Property } from "@mikro-orm/core";

@Entity()
export class WalletAddressEntity {
    @PrimaryKey()
    address!: string;

    @Property()
    encryptedPrivateKey!: string;

    @Property({ type: 'boolean', default: false })
    isDeleting = false;

    @Property({ onCreate: () => new Date(), defaultRaw: 'CURRENT_TIMESTAMP' })
    createdAt: Date = new Date();

    @Property({ onUpdate: () => new Date(), defaultRaw: 'CURRENT_TIMESTAMP' })
    updatedAt: Date = new Date();
}
