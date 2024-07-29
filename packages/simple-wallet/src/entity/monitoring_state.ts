import { Entity, PrimaryKey, Property } from "@mikro-orm/core";

@Entity({ tableName: "monitoring" })
export class MonitoringStateEntity {
    @PrimaryKey({ autoincrement: true })
    id!: number;

    @Property()
    chainType!: string;

    @Property()
    isMonitoring!: boolean;

    @Property({ onCreate: () => new Date() })
    createdAt: Date = new Date();

    @Property({ onUpdate: () => new Date() })
    updatedAt: Date = new Date();
}
