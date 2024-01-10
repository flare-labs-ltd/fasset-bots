import { ErrorFilter, expectErrors } from "../helpers";

export class ExitScope extends Error {
    constructor(public scope?: EventScope) {
        super("no matching scope");
    }
}

export class EventScope {
    exitOnExpectedError(error: any, expectedErrors: ErrorFilter[]): never {
        expectErrors(error, expectedErrors);
        throw new ExitScope(this);
    }
}
