import { ErrorFilter, expectErrors } from "../helpers";

export interface EventSubscription {
    unsubscribe(): void;
}

class ScopedSubscription implements EventSubscription {
    constructor(
        private scope?: EventScope,
        private subscription?: EventSubscription
    ) { }

    unsubscribe(): void {
        if (this.subscription) {
            if (this.scope) {
                this.scope.remove(this.subscription);
                this.scope = undefined;
            }
            this.subscription.unsubscribe();
            this.subscription = undefined;
        }
    }
}

export class ExitScope extends Error {
    constructor(public scope?: EventScope) {
        super("no matching scope");
    }
}

export class EventScope {
    constructor(
        private parent?: EventScope
    ) {
        if (parent) {
            parent.children.add(this);
        }
    }

    private subscriptions: Set<EventSubscription> = new Set();
    private children: Set<EventScope> = new Set();

    add(subscription: EventSubscription): EventSubscription {
        this.subscriptions.add(subscription);
        return new ScopedSubscription(this, subscription);
    }

    finish(): void {
        for (const child of this.children) {
            child.parent = undefined;   // prevent deleting from this.children
            child.finish();
        }
        this.children.clear();
        for (const subscription of this.subscriptions) {
            subscription.unsubscribe();
        }
        this.subscriptions.clear();
        this.parent?.children.delete(this);
    }

    remove(subscription: EventSubscription) {
        this.subscriptions.delete(subscription);
    }

    exit(): never {
        throw new ExitScope(this);
    }

    exitOnExpectedError(error: any, expectedErrors: ErrorFilter[]): never {
        expectErrors(error, expectedErrors);
        throw new ExitScope(this);
    }
}
