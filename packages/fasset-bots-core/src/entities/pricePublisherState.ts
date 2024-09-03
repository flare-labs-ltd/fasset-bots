import { Entity, Property, PrimaryKey } from "@mikro-orm/core";

@Entity({ tableName: 'pricePublisherState' })
export class PricePublisherState {
    @PrimaryKey({ type: 'int', autoincrement: true })
    id!: number;

    @Property({ type: 'varchar' })
    name!: string;

    @Property()
    valueNumber: number = 0;

    @Property()
    timestamp: number = 0;
}
