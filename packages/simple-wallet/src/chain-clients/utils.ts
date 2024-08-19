import {
    ValidationError,
    DriverException,

} from "@mikro-orm/core";

export function isORMError(e: any) {
    return e instanceof  ValidationError || e instanceof DriverException;
}