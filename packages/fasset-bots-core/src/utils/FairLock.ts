type Resolve<T> = (value: T) => void;

export class FairLock {
    currentLockId: number | null = null;
    waiting: Resolve<number>[] = [];
    nextLockId: number = 0;

    lock() {
        return new Promise((resolve: Resolve<number>) => {
            if (this.currentLockId != null) {
                this.waiting.push(resolve);
            } else {
                this.currentLockId = this.nextLockId++;
                resolve(this.currentLockId);
            }
        });
    }

    release(lockId: number) {
        if (lockId !== this.currentLockId) {
            throw new Error(`Cannot release unowned lock id ${lockId}; current lock id is ${this.currentLockId}.`);
        }
        if (this.waiting.length > 0) {
            const [nextResolve] = this.waiting.splice(0, 1);
            this.currentLockId = this.nextLockId++;
            nextResolve(this.currentLockId);
        } else {
            this.currentLockId = null;
        }
    }

    async lockAndRun(method: () => Promise<void>) {
        const lockId = await this.lock();
        try {
            await method();
        } finally {
            this.release(lockId);
        }
    }
}
