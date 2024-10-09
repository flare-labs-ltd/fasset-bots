import { Entity, PrimaryKey, Property } from "@mikro-orm/core";
import { PostAlert } from "../../../../../fasset-bots-core/src/utils/notifier/NotifierTransports";

@Entity({ tableName: "alert" })
export class Alert {
    @PrimaryKey({ autoincrement: true })
    id!: number;

    @Property()
    alert!: PostAlert;

    @Property()
    expiration!: number;

    @Property({ nullable: true })
    date: number | null;

    constructor(notification: PostAlert, expiration: number, date: number) {
        this.alert = notification;
        this.expiration = expiration;
        this.date = date;
    }

}