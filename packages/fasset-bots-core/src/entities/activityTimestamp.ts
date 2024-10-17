import { Entity, PrimaryKey, Property } from "@mikro-orm/core";
import { BNType } from "../config/orm-types";
import { toBN } from "web3-utils";
import BN from "bn.js";

@Entity({ tableName: "activity_timestamp" })
export class ActivityTimestampEntity {

    @PrimaryKey({ autoincrement: true })
    id!: number;

    @Property({ type: BNType })
    lastActiveTimestamp: BN = toBN(0); // stored in seconds in UTC

}
