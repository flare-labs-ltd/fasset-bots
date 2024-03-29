import chalk from "chalk";
import { logger } from "./logger";

/**
 * A type of error that prints nice message instead of stack trace in command line tools.
 */
export class CommandLineError extends Error {
    static wrap(error: any) {
        return error?.message ? new CommandLineError(error.message) : error;
    }
}

/**
 * Check if value is non-null and throw otherwise.
 * Returns guaranteed non-null value.
 */
export function requireNotNullCmd<T>(x: T, errorMessage: string): NonNullable<T> {
    if (x != null) return x as NonNullable<T>;
    throw new CommandLineError(errorMessage);
}

/**
 * Check if value is non-null and throw otherwise.
 */
export function assertNotNullCmd<T>(x: T, errorMessage: string): asserts x is NonNullable<T> {
    if (x == null) {
        throw new CommandLineError(errorMessage);
    }
}

const toplevelRunFinalizers: Array<() => Promise<void>> = [];

export function registerToplevelFinalizer(finalizer: () => Promise<void>) {
    toplevelRunFinalizers.push(finalizer);
}

// toplevel async function runner for node.js
export function toplevelRun(main: () => Promise<void>) {
    const scriptInfo = `${require.main?.filename ?? "UNKNOWN"} [pid=${process.pid}]`;
    logger.info(`***** ${scriptInfo} starting...`);
    runWithFinalizers(main)
        .then(() => {
            logger.info(`***** ${scriptInfo} ended successfully.`);
        })
        .catch((error) => {
            if (error instanceof CommandLineError) {
                logger.error(`***** ${scriptInfo} ended with user error: ${error}`);
                console.error(chalk.red("Error:"), error.message);
                process.exitCode = 1;
            } else {
                logger.error(`***** ${scriptInfo} ended with unexpected error:`, error);
                console.error(error);
                process.exitCode = 2;
            }
        })
        .finally(() => {
            // after 5s wait for close, terminate program
            const timeoutMS = 5000;
            setTimeout(() => {
                logger.warn(`***** ${scriptInfo} didn't exit after ${timeoutMS / 1000}s, terminating.`);
                setTimeout(() => { process.exit(process.exitCode ?? 0); }, 200); // wait for logger to finish
            }, timeoutMS).unref();
        });
}

async function runWithFinalizers(main: () => Promise<void>) {
    try {
        await main();
    } finally {
        // run registered finalizers
        while (toplevelRunFinalizers.length > 0) {
            const finalizer = toplevelRunFinalizers.pop()!;
            try {
                await finalizer();
            } catch (e) {
                logger.error(`Error during program finalization [pid=${process.pid}]:`, e);
            }
        }
    }
}
