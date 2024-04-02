
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
