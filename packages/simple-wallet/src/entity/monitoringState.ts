import { Entity, PrimaryKey, Property } from "@mikro-orm/core";
import BN from "bn.js";
import { BNType } from "../utils/orm-types";
import { toBN } from "../utils/bnutils";

@Entity({ tableName: "monitoring" })
export class MonitoringStateEntity {
    @PrimaryKey({ autoincrement: true })
    id!: number;

    @Property()
    chainType!: string;

    @Property({ type: BNType })
    lastPingInTimestamp: BN = toBN((new Date()).getTime());

    @Property()
    processOwner = "";

    @Property({ onCreate: () => new Date(), defaultRaw: 'CURRENT_TIMESTAMP' })
    createdAt: Date = new Date();

    @Property({ onUpdate: () => new Date(), defaultRaw: 'CURRENT_TIMESTAMP' })
    updatedAt: Date = new Date();
}
