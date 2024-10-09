/* istanbul ignore next */
export class SimpleRateLimiter<T> {
    private _lastRequestedAt: Map<T, number> = new Map<T, number>();

    constructor(public minInterval: number) {}

    allow(sender: T): boolean {
        const lastRequestedAt = this._lastRequestedAt.get(sender) ?? 0;
        const now = Date.now();
        if (now - lastRequestedAt >= this.minInterval) {
            // update only if request was allowed
            this.updateLastReqeusted(sender, now);
            return true;
        }
        return false;
    }

    private updateLastReqeusted(sender: T, time: number) {
        this._lastRequestedAt.set(sender, time);
    }
}