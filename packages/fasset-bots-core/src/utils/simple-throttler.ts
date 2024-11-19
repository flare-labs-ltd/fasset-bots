/* istanbul ignore next */
export class SimpleThrottler<T> {
    private lastAccessed: Map<T, number> = new Map<T, number>();

    constructor(public minInterval: number) {}

    allow(service: T): boolean {
        const la = this.lastAccessed.get(service) ?? 0;
        const now = Date.now();
        if (now - la >= this.minInterval) {
            // update only if request was allowed
            this.updateLastReqeusted(service, now);
            return true;
        }
        return false;
    }

    private updateLastReqeusted(sender: T, time: number) {
        this.lastAccessed.set(sender, time);
    }
}