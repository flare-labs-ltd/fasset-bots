import { reportError } from "../helpers";
import { EventScope, ExitScope } from "./ScopedEvents";

export class ScopedRunner {
    logError: (e: any) => void = reportError;

    scopes = new Set<EventScope>();
    runningThreads = 0;

    uncaughtErrors: any[] = [];

    newScope() {
        const scope = new EventScope();
        this.scopes.add(scope);
        return scope;
    }

    finishScope(scope: EventScope) {
        this.scopes.delete(scope);
    }

    startThread(method: (scope: EventScope) => Promise<void>): void {
        const scope = this.newScope();
        ++this.runningThreads;
        void method(scope)
            .catch(e => {
                if (e instanceof ExitScope) {
                    /* istanbul ignore next */
                    if (e.scope == null || e.scope === scope) return;
                }
                this.logError(e);
                this.uncaughtErrors.push(e);
            })
            .finally(() => {
                --this.runningThreads;
                return this.finishScope(scope);
            });
    }

}
