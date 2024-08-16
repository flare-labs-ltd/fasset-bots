import { Type } from "@mikro-orm/core";
import BN from "bn.js";

export class BNType extends Type<BN | string | number | null> {
    override convertToDatabaseValue(value: string | number | BN | null): string | null{
        if (value === null) return null;
        if (typeof value === "string") return value;
        return value.toString(10);
    }

    override convertToJSValue(value: string | number | BN): BN {
        if (typeof value === "string") return new BN(value, 10);
        if (typeof value === "number") return new BN(value);
        return value;
    }

    override getColumnType(): string {
        return `decimal(38, 0)`;
    }
}
