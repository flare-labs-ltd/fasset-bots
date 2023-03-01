import { EntityProperty, Platform, Type } from "@mikro-orm/core";
import BN from "bn.js";

export class BNType extends Type<BN, string> {
    override convertToDatabaseValue(value: string | BN, platform: Platform): string {
        if (typeof value === 'string') return value;
        return value.toString(10);
    }

    override convertToJSValue(value: string | BN, platform: Platform): BN {
        if (value instanceof BN) return value;
        return new BN(value, 10);
    }

    override getColumnType(prop: EntityProperty<any>, platform: Platform): string {
        return `decimal(38, 0)`;
    }
}
