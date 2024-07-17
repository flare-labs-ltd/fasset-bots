import { Entity, PrimaryKey, Property } from "@mikro-orm/core";
import { ADDRESS_LENGTH } from "./common";

@Entity()
export class WalletAddress {
    @PrimaryKey({ length: ADDRESS_LENGTH })
    address!: string;

    @Property()
    encryptedPrivateKey!: string;
}