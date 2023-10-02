export class PromiseCancelled extends Error {
    constructor(message = "Promise cancelled") {
        super(message);
    }
}

export interface CancelTokenRegistration {
    unregister(): void;
}

export class CancelToken {
    cancelled = false;
    registrations = new Set<() => void>();

    register(reject: (err: any) => void): CancelTokenRegistration {
        // creating error here gives more useful stack trace where the cancellec promise is created
        // otherwise we get the stack trace of cancel() call
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

    check() {
        if (this.cancelled) {
            throw new PromiseCancelled();
        }
    }

    cancel() {
        this.cancelled = true;
        for (const reject of Array.from(this.registrations)) {
            reject();
        }
        this.registrations.clear();
    }
}

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
