import {
    ValidationError,
    DriverException,

} from "@mikro-orm/core";

export function isORMError(e: any) {
    return e instanceof ValidationError || e instanceof DriverException;
}

export function errorMessage(e: any) {
    return e instanceof Error ? `${e.name} - ${e.message}: \n ${e.stack}` : e;
}