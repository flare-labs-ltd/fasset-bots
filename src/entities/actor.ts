import { Entity, PrimaryKey, Property } from "@mikro-orm/core";
import { ADDRESS_LENGTH } from "./common";

@Entity({ tableName: 'actor' })
export class ActorEntity {
    @PrimaryKey({ length: ADDRESS_LENGTH })
    address!: string;

    @Property()
    chainId!: number;

    @Property({ nullable: true })
    lastEventBlockHandled!: number;

    @Property({ nullable: true })
    lastEventTimestampHandled?: number;

    @Property()
    type!: ActorType;
}

export enum ActorType {
    CHALLENGER = 'challenger',
    LIQUIDATION_TRIGGER = 'liquidationTrigger'
}