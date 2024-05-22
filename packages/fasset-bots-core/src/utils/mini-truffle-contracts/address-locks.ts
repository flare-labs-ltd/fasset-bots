import fs from "fs";
import path from "path";
import { sleep } from "../helpers";
import { logger } from "../logger";

const SLEEP_TIME = 100;
const SLEEP_TIME_AFTER_EXPIRATION = 2000;

export class AddressLockTimeoutError extends Error {}

export interface LockId {
    id: string;
    address: string;
}

export interface AddressLocks {
    /**
     * Acquire a lock for an address.
     * @returns lock id that must be used in `release`
     */
    lock(address: string): Promise<LockId>;

    /**
     * Release a lock for an address.
     */
    release(lock: LockId): Promise<void>;
}

export interface MemoryAddressLocksSettings {
    /**
     * Maximum number of milliseconds to wait for locking an address before giving up.
     * Locking the address makes sure that there are no "nonce too low" or "replacemenet transactio underpriced" errors
     * because two transaction from the same address try to execute.
     */
    waitTimeoutMS: number;
}

/**
 * In-process locking strategy. Not safe for multiple processes - only use for Hardhat tests.
 */
export class MemoryAddressLocks implements AddressLocks {
    constructor(
        public settings: MemoryAddressLocksSettings,
    ) {}

    private addressLocks = new Set<string>();

    async lock(address: string) {
        const start = systemTimestampMS();
        while (systemTimestampMS() - start < this.settings.waitTimeoutMS) {
            if (!this.addressLocks.has(address)) {
                this.addressLocks.add(address);
                return { address, id: address };
            }
            await sleep(100);
        }
        throw new AddressLockTimeoutError("Timeout waiting to obtain address nonce lock");
    }

    async release(lock: LockId) {
        this.addressLocks.delete(lock.address);
    }
}

export interface FilesystemAddressLocksSettings {
    /**
     * Maximum number of milliseconds to wait for locking an address before giving up.
     * Locking the address makes sure that there are no "nonce too low" or "replacemenet transaction underpriced" errors
     * because two transaction from the same address try to execute.
     */
    waitTimeoutMS: number;

    /**
     * If program crashes, some lock files may remain. Therefore lock files older than `addressLockExpirationMS` will be automatically deleted.
     */
    lockExpirationMS: number;

    /**
     * The directory that will hold the lock files.
     */
    lockDir: string;
}

/**
 * Address lock strategy that is multi-processes safe.
 */
export class FilesystemAddressLocks implements AddressLocks {
    constructor(
        public settings: FilesystemAddressLocksSettings,
    ) {}

    nextLockIndex: number = 1;

    async lock(address: string) {
        FilesystemAddressLocks.initializeDir(this.settings.lockDir);
        const lockfile = this.lockFileName(address);
        const lockId = `${process.pid}-${this.nextLockIndex++}`;
        const start = systemTimestampMS();
        while (systemTimestampMS() - start < this.settings.waitTimeoutMS) {
            try {
                fs.writeFileSync(lockfile, lockId, { encoding: "ascii", flag: "wx" });
                return { address, id: lockId };
            } catch (e) {
                // check for expired files
                const stat = fs.statSync(lockfile, { throwIfNoEntry: false });
                if (stat != null && systemTimestampMS() - stat.mtimeMs > this.settings.lockExpirationMS) {
                    // This could cause race condition if other process creates new lock file before this one deletes it.
                    // That's why we wait rather long SLEEP_TIME_AFTER_EXPIRATION afterwards, so there is a time window when there is no file.
                    // During that time all processes should finish deleting the file.
                    logger.warn(`Deleting expired lock file for address ${address}`);
                    try {
                        fs.rmSync(lockfile, { force: true });
                    } catch (error) {
                        /* istanbul ignore next */
                        logger.error(`Error deleting expired lockfile ${lockfile}`, e);
                    }
                    await sleep(SLEEP_TIME_AFTER_EXPIRATION);
                }
            }
            await sleep(SLEEP_TIME);
        }
        throw new AddressLockTimeoutError("Timeout waiting to obtain address nonce lock");
    }

    async release(lock: LockId) {
        const lockfile = this.lockFileName(lock.address);
        try {
            const text = fs.readFileSync(lockfile).toString();
            if (text === lock.id) {
                fs.rmSync(lockfile, { force: true });
            }
        } catch (e) {
            /* istanbul ignore next */
            logger.error(`Error releasing lockfile ${lockfile}`, e);
        }
    }

    lockFileName(address: string) {
        return path.resolve(this.settings.lockDir, `${address}.lock`);
    }

    static cleanupRegistered = false;
    static cleanupDirs = new Set<string>();

    static initializeDir(dir: string) {
        assureDirectoryExists(dir);
        // register for cleanup
        this.cleanupDirs.add(dir);
        if (!this.cleanupRegistered) {
            process.on("exit", () => this.cleanup());
            this.cleanupRegistered = true;
        }
    }

    static cleanup(): void {
        for (const dir of this.cleanupDirs) {
            const files = fs.readdirSync(dir);
            for (const fname of files) {
                const lockfile = path.resolve(dir, fname);
                try {
                    const text = fs.readFileSync(lockfile).toString();
                    if (text.startsWith(`${process.pid}-`)) {
                        logger.warn(`Deleting leftover lock file ${fname} with id ${text}`);
                        fs.rmSync(lockfile, { force: true });
                    }
                } catch (e) {
                    /* istanbul ignore next */
                    logger.error(`Error cleaning up lockfile ${lockfile}`, e);
                }
            }
        }
    }
}

function systemTimestampMS() {
    return new Date().getTime();
}

function assureDirectoryExists(dir: string) {
    if (!fs.existsSync(dir)) {
        try {
            fs.mkdirSync(dir, { recursive: true });
        } catch (e) {
            /* istanbul ignore next */
            logger.error(`Problem creating directory "${dir}"`);
        }
    }
}
