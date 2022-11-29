import { Entity, PrimaryKey, Property } from "@mikro-orm/core";
import { ADDRESS_LENGTH } from "./common";

@Entity({ tableName: 'challenger' })
export class ChallengerEntity {
    @PrimaryKey({ length: ADDRESS_LENGTH })
    address!: string;

    @Property()
    chainId!: number;

    @Property({ nullable: true })
    lastEventBlockHandled!: number;

    @Property({ nullable: true })
    lastEventTimestampHandled!: number;
}