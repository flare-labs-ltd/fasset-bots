import { ActorBaseKind } from "../../fasset-bots/ActorBase";
import { ErrorFilter, errorIncluded } from "../helpers";
import { logger } from "../logger";

export class ExitScope extends Error {
    constructor(public scope?: EventScope) {
        super("no matching scope");
    }
}

export class EventScope {
    exitOnExpectedError(error: any, expectedErrors: ErrorFilter[], kind: ActorBaseKind | "AGENT" | "USER", address: string): never {
        const actor = kind === "AGENT" || kind === "USER" ? kind : ActorBaseKind[kind];
        if (errorIncluded(error, expectedErrors)) {
            logger.error(`${actor} ${address} exited on expected error:`, error);
            throw new ExitScope(this);
        }
        logger.error(`${actor} ${address} exited on UNexpected error:`, error);
        throw error; // unexpected error
    }
}
