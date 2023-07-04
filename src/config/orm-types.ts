import { Type } from "@mikro-orm/core";
import BN from "bn.js";

export class BNType extends Type<BN, string> {
    override convertToDatabaseValue(value: string | BN): string {
        if (typeof value === 'string') return value;
        return value.toString(10);
    }

    override convertToJSValue(value: string | BN): BN {
        if (typeof value == 'string') return new BN(value, 10);
        return value;
    }

    override getColumnType(): string {
        return `decimal(38, 0)`;
    }
}
