import { Entity, PrimaryKey, Property } from "@mikro-orm/core";

@Entity({ tableName: "alertFull" })
export class Alert {
    @PrimaryKey({ autoincrement: true })
    id!: number;

    @Property()
    bot_type!: string;

    @Property()
    address!: string;

    @Property()
    level!: string;

    @Property()
    title!: string;

    @Property()
    description!: string;

    @Property()
    expiration!: number;

    @Property({ nullable: true })
    date: number | null;

    constructor(bot_type: string, address: string, level: string, title: string, description: string, expiration: number, date: number) {
        this.bot_type = bot_type;
        this.address = address;
        this.level = level;
        this.title = title;
        this.description = description;
        this.expiration = expiration;
        this.date = date;
    }

}
