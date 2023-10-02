/**
 * The exception with which the registered promises are rejected on token cancelation.
 */
export class PromiseCancelled extends Error {
    constructor(message = "Promise cancelled") {
        super(message);
    }
}

/**
 * An object returned by `canceltoken.register(...)` the allows for unregistering on cleanup.
 */
export interface CancelTokenRegistration {
    unregister(): void;
}

/**
 * The object with which it is possible to cancel one or more promises.
 * See `cancelableSleep` for typical usage.
 */
export class CancelToken {
    cancelled = false;
    registrations = new Set<() => void>();

    /**
     * Registers a promise rejection for when the token is cancelled.
     * If the token is already cancelled, the prmise will reject immediately (in the next tick).
     * @param reject The promise rejection function.
     * @returns A registration object used to unregister on cleanup.
     */
    register(reject: (err: any) => void): CancelTokenRegistration {
        // Creating error here gives more useful stack trace where the cancelled promise is created;
        // otherwise we get the stack trace of cancel() call.
        const error = new PromiseCancelled();
        const rejectFn = () => reject(error);
        if (this.cancelled) {
            setTimeout(rejectFn, 0); // immediately reject
        } else {
            this.registrations.add(rejectFn);
        }
        return {
            unregister: () => { this.registrations.delete(rejectFn); }
        };
    }

    /**
     * Check if token is already cancelled and if ti is immediately throw exception.
     */
    check() {
        if (this.cancelled) {
            throw new PromiseCancelled();
        }
    }

    /**
     * Mark token as cancelled and reject all the registered promises with `PromiseCancelled()`.
     */
    cancel() {
        this.cancelled = true;
        for (const reject of Array.from(this.registrations)) {
            reject();
        }
        this.registrations.clear();
    }
}

/**
 * Asynchronously sleep for `ms` milliseconds, but with the possibility of cancellation.
 * @param ms milliseconds to sleep
 * @param cancelToken the token to trigger premature cancelation
 */
export function cancelableSleep(ms: number, cancelToken: CancelToken) {
    let cancelRegistration: CancelTokenRegistration;
    let timer: NodeJS.Timeout;
    return new Promise<void>((resolve, reject) => {
        timer = setTimeout(() => resolve(), ms);
        cancelRegistration = cancelToken.register(reject);
    }).finally(() => {
        cancelRegistration.unregister();
        clearTimeout(timer);
    });
}
